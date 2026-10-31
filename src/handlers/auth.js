const customerRepository = require('../services/customerRepository');
const { CpfError, normalizeCpf, maskCpf } = require('../utils/cpf');
const { invalidCpf, customerNotFound, inactiveCustomer } = require('../utils/errors');
const { parseJsonBody, requireString, withHttp } = require('../utils/http');

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

  return { statusCode: 501, body: '' };
}

exports.handler = withHttp('POST /auth', authenticate);
