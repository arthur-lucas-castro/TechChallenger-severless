const refreshTokenService = require('../services/refreshTokenService');
const tokenService = require('../services/tokenService');
const { parseJsonBody, requireString, tokenResponse, withHttp } = require('../utils/http');

async function refresh(event, log) {
  const token = requireString(parseJsonBody(event), 'refreshToken');

  const session = await refreshTokenService.rotateSession(token, log);
  const access = await tokenService.signAccessToken(session.principal);

  return tokenResponse(access, session);
}

exports.handler = withHttp('POST /auth/refresh', refresh);
