const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(DIST, 'build');
const ZIP = path.join(DIST, 'lambda-auth.zip');

// Dependências que ficam fora do bundle e vão no zip com as suas próprias dependências.
const UNBUNDLED_DEPENDENCIES = ['pg'];

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * Pacotes de node_modules (instalação plana do npm ci) necessários para os nomes dados.
 * Dependência aninhada em node_modules/<pacote>/node_modules vai junto com o pacote;
 * dependência opcional ausente (ex.: pg-native) é ignorada.
 */
function dependencyClosure(names) {
  const found = new Set();
  const pending = [...names];
  while (pending.length > 0) {
    const name = pending.pop();
    const manifest = path.join(BUILD, 'node_modules', name, 'package.json');
    if (found.has(name) || !fs.existsSync(manifest)) {
      continue;
    }
    found.add(name);
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    pending.push(...Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }));
  }
  for (const name of names) {
    if (!found.has(name)) {
      throw new Error(`${name} não está em ${path.join(BUILD, 'node_modules')}.`);
    }
  }
  return [...found].sort();
}

function addDirectory(zip, dir, zipDir) {
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(dir, file).split(path.sep).join('/');
    const zipPath = path.posix.join(zipDir, relative);
    zip.addFile(zipPath, fs.readFileSync(file), '', 0o644);
  }
}

function directorySize(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((total, entry) => {
      return total + fs.statSync(path.join(entry.parentPath, entry.name)).size;
    }, 0);
}

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });

  // Pasta isolada: o npm ci --omit=dev na raiz apagaria o esbuild e as ferramentas de teste.
  for (const file of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(ROOT, file), path.join(BUILD, file));
  }
  fs.cpSync(path.join(ROOT, 'src'), path.join(BUILD, 'src'), { recursive: true });
  execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', {
    cwd: BUILD,
    stdio: 'inherit',
  });

  const outfile = path.join(BUILD, 'out', 'index.js');
  await esbuild.build({
    absWorkingDir: BUILD,
    entryPoints: ['src/index.js'],
    outfile,
    bundle: true,
    minify: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: [
      // Vem no runtime nodejs20.x.
      '@aws-sdk/*',
      // Require opcional do pg que não usamos.
      'pg-native',
      // Vêm do layer Datadog-Node20-x (/opt/nodejs/node_modules).
      'datadog-lambda-js',
      'dd-trace',
      // O tracer instrumenta o pg interceptando o require('pg'); dentro do bundle não há
      // require, e as queries sumiriam do trace. Vai no zip, em node_modules.
      ...UNBUNDLED_DEPENDENCIES,
    ],
    legalComments: 'none',
  });

  const zip = new AdmZip();
  // Permissão explícita: um zip gerado no Windows pode chegar à Lambda sem bit de leitura.
  zip.addFile('index.js', fs.readFileSync(outfile), '', 0o644);
  const shipped = dependencyClosure(UNBUNDLED_DEPENDENCIES);
  for (const name of shipped) {
    addDirectory(zip, path.join(BUILD, 'node_modules', name), `node_modules/${name}`);
  }
  zip.writeZip(ZIP);
  console.log(`node_modules no zip: ${shipped.join(', ')}`);

  const mode = (new AdmZip(ZIP).getEntry('index.js').attr >>> 16) & 0o777;
  if (mode !== 0o644) {
    throw new Error(`index.js gravado no zip com permissão ${mode.toString(8)}, esperado 644.`);
  }

  const unbundled =
    directorySize(path.join(BUILD, 'node_modules')) + directorySize(path.join(BUILD, 'src'));
  console.log(`node_modules + src: ${kb(unbundled)}`);
  console.log(`bundle:             ${kb(fs.statSync(outfile).size)}`);
  console.log(`${path.relative(ROOT, ZIP)}: ${kb(fs.statSync(ZIP).size)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
