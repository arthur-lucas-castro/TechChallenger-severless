const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(DIST, 'build');
const ZIP = path.join(DIST, 'lambda-auth.zip');

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

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
    // @aws-sdk vem no runtime nodejs20.x; pg-native é um require opcional do pg que não usamos.
    external: ['@aws-sdk/*', 'pg-native'],
    legalComments: 'none',
  });

  const zip = new AdmZip();
  // Permissão explícita: um zip gerado no Windows pode chegar à Lambda sem bit de leitura.
  zip.addFile('index.js', fs.readFileSync(outfile), '', 0o644 << 16);
  zip.writeZip(ZIP);

  const unbundled = directorySize(path.join(BUILD, 'node_modules')) + directorySize(path.join(BUILD, 'src'));
  console.log(`node_modules + src: ${kb(unbundled)}`);
  console.log(`bundle:             ${kb(fs.statSync(outfile).size)}`);
  console.log(`${path.relative(ROOT, ZIP)}: ${kb(fs.statSync(ZIP).size)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
