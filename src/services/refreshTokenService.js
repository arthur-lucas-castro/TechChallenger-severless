const crypto = require('node:crypto');
const { positiveIntEnv } = require('../utils/config');
const { inactiveCustomer, invalidRefreshToken } = require('../utils/errors');
const { CUSTOMER_ROLE, canAuthenticate } = require('./customerRepository');
const db = require('./db');

const DEFAULT_REFRESH_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_SESSION_MAX_SECONDS = 30 * 24 * 60 * 60;

// 32 bytes em Base64URL. O formato é conferido antes de ir ao banco.
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

const INSERT_SESSION = `
  INSERT INTO refresh_token
    (id, cliente_id, usuario_id, familia_id, token_hash, expira_em, sessao_expira_em)
  VALUES (
    $1, $2, $3, $4, $5,
    least(now() + make_interval(secs => $6::double precision),
          now() + make_interval(secs => $7::double precision)),
    now() + make_interval(secs => $7::double precision)
  )
  RETURNING floor(extract(epoch FROM expira_em - now()))::int AS refresh_expires_in`;

const DELETE_EXPIRED_SESSIONS = `
  DELETE FROM refresh_token
  WHERE (cliente_id = $1 OR usuario_id = $2) AND sessao_expira_em < now()`;

const FIND_FOR_UPDATE = `
  SELECT t.id, t.cliente_id, t.usuario_id, t.familia_id, t.usado_em, t.revogado_em,
         c.status, u.tipo,
         (t.expira_em <= now() OR t.sessao_expira_em <= now()) AS expirado
  FROM refresh_token t
  LEFT JOIN cliente c ON c.id = t.cliente_id
  LEFT JOIN usuario u ON u.id = t.usuario_id
  WHERE t.token_hash = $1
  FOR UPDATE OF t`;

const REVOKE_FAMILY = `
  UPDATE refresh_token SET revogado_em = now()
  WHERE familia_id = $1 AND revogado_em IS NULL`;

const INSERT_ROTATED = `
  INSERT INTO refresh_token
    (id, cliente_id, usuario_id, familia_id, token_hash, expira_em, sessao_expira_em)
  SELECT $1::uuid, cliente_id, usuario_id, familia_id, $2::char(64),
         least(now() + make_interval(secs => $3::double precision), sessao_expira_em),
         sessao_expira_em
  FROM refresh_token
  WHERE id = $4
  RETURNING floor(extract(epoch FROM expira_em - now()))::int AS refresh_expires_in`;

const MARK_ROTATED = `
  UPDATE refresh_token
  SET usado_em = now(), revogado_em = now(), substituido_por = $1
  WHERE id = $2`;

const REVOKE_FAMILY_BY_TOKEN = `
  UPDATE refresh_token SET revogado_em = now()
  WHERE revogado_em IS NULL
    AND familia_id = (SELECT familia_id FROM refresh_token WHERE token_hash = $1)`;

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// O token tem 256 bits aleatórios: não há força bruta a temer, então SHA-256 simples basta.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function refreshExpiresInSeconds() {
  return positiveIntEnv('REFRESH_EXPIRES_IN_SECONDS', DEFAULT_REFRESH_EXPIRES_IN_SECONDS);
}

/**
 * Abre uma sessão (nova família) e apaga as sessões vencidas do mesmo dono.
 * @param {{ clienteId?: number, usuarioId?: number }} owner exatamente um dos dois
 */
async function createSession({ clienteId = null, usuarioId = null }) {
  const refreshToken = generateToken();
  const familyId = crypto.randomUUID();

  const { rows } = await db.query(INSERT_SESSION, [
    crypto.randomUUID(),
    clienteId,
    usuarioId,
    familyId,
    hashToken(refreshToken),
    refreshExpiresInSeconds(),
    positiveIntEnv('SESSION_MAX_SECONDS', DEFAULT_SESSION_MAX_SECONDS),
  ]);
  await db.query(DELETE_EXPIRED_SESSIONS, [clienteId, usuarioId]);

  return { refreshToken, refreshExpiresIn: rows[0].refresh_expires_in, familyId };
}

// O perfil vem do banco a cada troca: uma mudança de `tipo` vale a partir da próxima renovação.
function principalOf(row) {
  return row.usuario_id
    ? { id: row.usuario_id, role: row.tipo }
    : { id: row.cliente_id, role: CUSTOMER_ROLE };
}

async function rotateWithin(client, current) {
  const refreshToken = generateToken();
  const newId = crypto.randomUUID();

  const { rows } = await client.query(INSERT_ROTATED, [
    newId,
    hashToken(refreshToken),
    refreshExpiresInSeconds(),
    current.id,
  ]);
  await client.query(MARK_ROTATED, [newId, current.id]);

  return {
    principal: principalOf(current),
    refreshToken,
    refreshExpiresIn: rows[0].refresh_expires_in,
  };
}

/**
 * Troca o refresh token por um novo. Toda a decisão fica em uma transação com o token travado por
 * FOR UPDATE: de duas chamadas simultâneas com o mesmo token, a segunda espera a primeira e cai
 * na regra de reuso, então nunca sobram dois tokens válidos.
 *
 * As recusas são devolvidas, e não lançadas, para que o COMMIT grave a revogação da família.
 * Uma exceção dentro da transação desfaria justamente essa revogação.
 */
async function rotateSession(token, log) {
  if (!TOKEN_FORMAT.test(token)) {
    throw invalidRefreshToken('TOKEN_MALFORMADO');
  }

  const result = await db.withTransaction(async (client) => {
    const { rows } = await client.query(FIND_FOR_UPDATE, [hashToken(token)]);
    const current = rows[0];
    if (!current) {
      return { rejection: invalidRefreshToken('TOKEN_DESCONHECIDO') };
    }
    log.add({
      clienteId: current.cliente_id,
      usuarioId: current.usuario_id,
      familiaId: current.familia_id,
    });

    // Um token já trocado só volta a aparecer se foi copiado: pode ter vazado. Não dá para saber
    // quem é o dono legítimo, então a sessão inteira cai e os dois lados fazem login de novo.
    if (current.usado_em) {
      await client.query(REVOKE_FAMILY, [current.familia_id]);
      log.warn('Reutilização de refresh token detectada; família revogada');
      return { rejection: invalidRefreshToken('TOKEN_REUTILIZADO') };
    }
    if (current.revogado_em) {
      return { rejection: invalidRefreshToken('TOKEN_REVOGADO') };
    }
    if (current.expirado) {
      return { rejection: invalidRefreshToken('TOKEN_EXPIRADO') };
    }
    // A tabela usuario não tem status: apagar o usuário apaga as sessões em cascata.
    if (current.cliente_id && !canAuthenticate(current.status)) {
      await client.query(REVOKE_FAMILY, [current.familia_id]);
      return { rejection: inactiveCustomer(`STATUS_${current.status}`) };
    }

    return { session: await rotateWithin(client, current) };
  });

  if (result.rejection) {
    throw result.rejection;
  }
  return result.session;
}

/** Revoga a sessão do token informado. Token desconhecido não é erro (logout idempotente). */
async function revokeSession(token) {
  if (TOKEN_FORMAT.test(token)) {
    await db.query(REVOKE_FAMILY_BY_TOKEN, [hashToken(token)]);
  }
}

module.exports = { createSession, rotateSession, revokeSession, hashToken };
