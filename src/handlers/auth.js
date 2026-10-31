const customerRepository = require('../services/customerRepository');
const refreshTokenService = require('../services/refreshTokenService');
const tokenService = require('../services/tokenService');
const { CpfError, normalizeCpf, maskCpf } = require('../utils/cpf');
const { invalidCpf, customerNotFound, inactiveCustomer } = require('../utils/errors');
const { json, parseJsonBody, requireString, withHttp } = require('../utils/http');

function readCpf(event, log) {
  const rawCpf = requireString(parseJsonBody(event), 'cpf');
  try {
    const cpf = normalizeCpf(rawCpf);
    log.add({ cpf: maskCpf(cpf) });
    return cpf;
  } catch (err) {
    if (err instanceof CpfError) {
      throw invalidCpf(err.reason);
    }
    throw err;
  }
}

async function authenticate(event, log) {
  const cpf = readCpf(event, log);

  const customer = await customerRepository.findByCpf(cpf);
  if (!customer) {
    throw customerNotFound();
  }
  log.add({ clienteId: customer.id });
  if (!customerRepository.canAuthenticate(customer.status)) {
    throw inactiveCustomer(`STATUS_${customer.status}`);
  }

  // Assina antes de gravar: uma falha aqui não deixa uma sessão órfã no banco.
  const { accessToken, expiresIn } = await tokenService.signAccessToken(customer.id);
  const session = await refreshTokenService.createSession(customer.id);
  log.add({ familiaId: session.familyId });

  return json(200, {
    accessToken,
    tokenType: 'Bearer',
    expiresIn,
    refreshToken: session.refreshToken,
    refreshExpiresIn: session.refreshExpiresIn,
  });
}

exports.handler = withHttp('POST /auth', authenticate);
