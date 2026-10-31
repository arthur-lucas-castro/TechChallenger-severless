const db = require('./db');

// Qualquer status fora desta lista bloqueia o acesso, inclusive um valor desconhecido.
const STATUSES_ALLOWED_TO_AUTHENTICATE = new Set(['ATIVO']);

const FIND_BY_CPF = `
  SELECT id, nome, status
  FROM cliente
  WHERE numerodocumento = $1
  ORDER BY id
  LIMIT 1`;

/** @param {string} cpf CPF normalizado, só com dígitos. */
async function findByCpf(cpf) {
  const { rows } = await db.query(FIND_BY_CPF, [cpf]);
  return rows[0] ?? null;
}

function canAuthenticate(status) {
  return STATUSES_ALLOWED_TO_AUTHENTICATE.has(status);
}

module.exports = { findByCpf, canAuthenticate };
