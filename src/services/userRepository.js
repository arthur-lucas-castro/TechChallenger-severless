const bcrypt = require('bcryptjs');
const db = require('./db');

const FIND_BY_EMAIL = `SELECT id, senhahash, tipo FROM usuario WHERE email = $1`;

// Hash de um valor aleatório descartado, com o mesmo custo dos hashes da tabela. E-mail inexistente
// também passa pelo bcrypt: sem isso, a resposta mais rápida revelaria quem está cadastrado.
const DECOY_HASH = '$2b$12$x/uvTDjPu1gDuavu.SDonuXMVZJZvbDIhoaHCQ93MGv55kKDrfCj2';

/** Devolve { id, tipo } se o e-mail e a senha conferem, ou null em qualquer outro caso. */
async function verifyCredentials(email, senha) {
  const { rows } = await db.query(FIND_BY_EMAIL, [email.toLowerCase()]);
  const user = rows[0];
  const matches = await bcrypt.compare(senha, user?.senhahash ?? DECOY_HASH);
  return user && matches ? { id: user.id, tipo: user.tipo } : null;
}

module.exports = { verifyCredentials };
