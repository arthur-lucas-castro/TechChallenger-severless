const { SSMClient, GetParametersCommand } = require('@aws-sdk/client-ssm');

const MIN_JWT_SECRET_BYTES = 32;

// Promise guardada fora do handler: o SSM é consultado uma vez por ambiente de execução (cold
// start). Em caso de falha o cache é limpo, para a próxima invocação tentar de novo.
let cached;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ${name} não configurada.`);
  }
  return value;
}

async function fetchSecrets() {
  const jwtParam = requireEnv('JWT_SECRET_PARAM');
  const dbPrefix = requireEnv('DB_PARAM_PREFIX');
  const dbParams = {
    host: `${dbPrefix}/host`,
    database: `${dbPrefix}/name`,
    user: `${dbPrefix}/username`,
    password: `${dbPrefix}/password`,
  };

  // Timeouts curtos: sem rota para o SSM, a chamada falharia só no timeout da Lambda.
  const client = new SSMClient({
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 3000 },
  });
  const result = await client.send(
    new GetParametersCommand({
      Names: [jwtParam, ...Object.values(dbParams)],
      WithDecryption: true,
    }),
  );

  if (result.InvalidParameters?.length) {
    throw new Error(`Parâmetros ausentes no SSM: ${result.InvalidParameters.join(', ')}`);
  }

  const values = new Map(result.Parameters.map((p) => [p.Name, p.Value]));
  const jwtSecret = values.get(jwtParam);

  // O .NET recusa chaves HS256 menores que 32 bytes (docs/auth-flow.md, seção 2.6).
  if (!jwtSecret || Buffer.byteLength(jwtSecret, 'utf8') < MIN_JWT_SECRET_BYTES) {
    throw new Error(`O segredo do JWT precisa ter no mínimo ${MIN_JWT_SECRET_BYTES} bytes.`);
  }

  const db = Object.fromEntries(
    Object.entries(dbParams).map(([key, name]) => [key, values.get(name)]),
  );
  return { jwtSecret, db };
}

function getSecrets() {
  if (!cached) {
    cached = fetchSecrets().catch((err) => {
      cached = undefined;
      throw err;
    });
  }
  return cached;
}

module.exports = { getSecrets };
