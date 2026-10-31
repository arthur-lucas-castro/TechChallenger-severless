const { CpfError, normalizeCpf, maskCpf } = require('../utils/cpf');
const { invalidCpf } = require('../utils/errors');
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
  readCpf(event, log);
  return { statusCode: 501, body: '' };
}

exports.handler = withHttp('POST /auth', authenticate);
