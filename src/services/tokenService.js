const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { positiveIntEnv } = require('../utils/config');
const { getSecrets } = require('./secrets');

const DEFAULT_EXPIRES_IN_SECONDS = 15 * 60;

// Mesmos valores de Jwt__Issuer e Jwt__Audience no configmap da API. O token não leva CPF nem hash
// de CPF (docs/auth-flow.md, seção 2.3).
async function signAccessToken(customerId) {
  const { jwtSecret } = await getSecrets();
  const expiresIn = positiveIntEnv('JWT_EXPIRES_IN_SECONDS', DEFAULT_EXPIRES_IN_SECONDS);

  const accessToken = jwt.sign({ role: 'cliente', type: 'access' }, jwtSecret, {
    algorithm: 'HS256',
    keyid: process.env.JWT_KID ?? 'v1',
    subject: String(customerId),
    issuer: process.env.JWT_ISSUER ?? 'TechChallenger',
    audience: process.env.JWT_AUDIENCE ?? 'TechChallenger',
    expiresIn,
    notBefore: 0,
    jwtid: crypto.randomUUID(),
  });

  return { accessToken, expiresIn };
}

module.exports = { signAccessToken };
