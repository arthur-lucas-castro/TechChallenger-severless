const refreshTokenService = require('../services/refreshTokenService');
const tokenService = require('../services/tokenService');
const { json, parseJsonBody, requireString, withHttp } = require('../utils/http');

async function refresh(event, log) {
  const token = requireString(parseJsonBody(event), 'refreshToken');

  const session = await refreshTokenService.rotateSession(token, log);
  const { accessToken, expiresIn } = await tokenService.signAccessToken(session.customerId);

  return json(200, {
    accessToken,
    tokenType: 'Bearer',
    expiresIn,
    refreshToken: session.refreshToken,
    refreshExpiresIn: session.refreshExpiresIn,
  });
}

exports.handler = withHttp('POST /auth/refresh', refresh);
