const refreshTokenService = require('../services/refreshTokenService');
const tokenService = require('../services/tokenService');
const userRepository = require('../services/userRepository');
const { invalidCredentials } = require('../utils/errors');
const { parseJsonBody, requireString, tokenResponse, withHttp } = require('../utils/http');

async function login(event, log) {
  const body = parseJsonBody(event);
  const email = requireString(body, 'email');
  const senha = requireString(body, 'senha');

  const user = await userRepository.verifyCredentials(email, senha);
  if (!user) {
    throw invalidCredentials();
  }
  log.add({ usuarioId: user.id });

  // Assina antes de gravar: uma falha aqui não deixa uma sessão órfã no banco.
  const access = await tokenService.signAccessToken({ id: user.id, role: user.tipo });
  const session = await refreshTokenService.createSession({ usuarioId: user.id });
  log.add({ familiaId: session.familyId });

  return tokenResponse(access, session);
}

exports.handler = withHttp('POST /auth/login', login);
