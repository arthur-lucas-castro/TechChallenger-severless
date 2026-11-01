const { Pool } = require('pg');
const { createLogger } = require('../utils/logger');
const { getSecrets } = require('./secrets');

const DEFAULT_POOL_MAX = 1;
const IDLE_TIMEOUT_MS = 60_000;
const CONNECT_TIMEOUT_MS = 3_000;
const STATEMENT_TIMEOUT_MS = 5_000;

// O pool fica fora do handler para sobreviver entre invocações do mesmo ambiente de execução.
// Abrir uma conexão TLS com o Postgres custa dezenas de milissegundos e uma conexão por invocação
// esgotaria o RDS. O tamanho padrão é 1 porque cada ambiente atende uma requisição por vez: o
// total de conexões fica igual à concorrência da Lambda (docs/auth-flow.md, seção 1.7).
let poolPromise;

async function createPool() {
  const { db } = await getSecrets();
  const pool = new Pool({
    ...db,
    port: Number(process.env.DB_PORT ?? 5432),
    // A validação do certificado usa o bundle indicado em NODE_EXTRA_CA_CERTS.
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: true },
    max: Number(process.env.DB_POOL_MAX ?? DEFAULT_POOL_MAX),
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: 'techchallenger-auth',
  });

  // Sem este listener, a queda de uma conexão ociosa derrubaria o processo.
  pool.on('error', (err) => {
    createLogger().warn('Conexão ociosa perdida', { errorCode: err.code });
  });
  return pool;
}

function getPool() {
  if (!poolPromise) {
    poolPromise = createPool().catch((err) => {
      poolPromise = undefined;
      throw err;
    });
  }
  return poolPromise;
}

async function query(text, params) {
  const pool = await getPool();
  return pool.query(text, params);
}

/** Roda `fn(client)` em uma transação. O retorno de `fn` é confirmado; uma exceção desfaz tudo. */
async function withTransaction(fn) {
  const pool = await getPool();
  const client = await pool.connect();
  let failure;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    failure = err;
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    // Com erro, a conexão é descartada: ela pode ter ficado em estado indefinido.
    client.release(failure);
  }
}

module.exports = { query, withTransaction };
