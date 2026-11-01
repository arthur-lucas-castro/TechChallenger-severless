const refreshTokenService = require('../services/refreshTokenService');
const { noContent, parseJsonBody, requireString, withHttp } = require('../utils/http');

async function logout(event) {
  const token = requireString(parseJsonBody(event), 'refreshToken');
  await refreshTokenService.revokeSession(token);
  return noContent();
}

exports.handler = withHttp('POST /auth/logout', logout);
