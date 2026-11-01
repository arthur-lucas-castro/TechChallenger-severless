/** Erro previsto do contrato (docs/auth-flow.md, seção 1.4). `reason` vai só para o log. */
class AppError extends Error {
  constructor(statusCode, code, message, reason) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.reason = reason;
  }
}

const invalidRequest = (reason) =>
  new AppError(400, 'REQUISICAO_INVALIDA', 'O corpo da requisição é inválido.', reason);

const invalidCpf = (reason) =>
  new AppError(400, 'CPF_INVALIDO', 'O CPF informado é inválido.', reason);

const customerNotFound = () =>
  new AppError(404, 'CLIENTE_NAO_ENCONTRADO', 'Cliente não encontrado.');

const inactiveCustomer = (reason) =>
  new AppError(403, 'CLIENTE_INATIVO', 'Cliente inativo. Procure a oficina.', reason);

const invalidCredentials = () =>
  new AppError(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha inválidos.');

const invalidRefreshToken = (reason) =>
  new AppError(
    401,
    'REFRESH_TOKEN_INVALIDO',
    'Sessão inválida ou expirada. Faça login novamente.',
    reason,
  );

const routeNotFound = () => new AppError(404, 'ROTA_NAO_ENCONTRADA', 'Rota não encontrada.');

const internalError = () =>
  new AppError(500, 'ERRO_INTERNO', 'Erro interno. Tente novamente mais tarde.');

const serviceUnavailable = () =>
  new AppError(
    503,
    'SERVICO_INDISPONIVEL',
    'Serviço temporariamente indisponível. Tente novamente.',
  );

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

// SQLSTATE: 08 = falha de conexão, 53 = falta de recursos (too_many_connections), 57P0x = banco
// encerrando, 57014 = statement_timeout.
const UNAVAILABLE_SQLSTATE = /^(08|53|57P0)|^57014$/;

// O pg não dá código a timeouts de conexão nem a conexões encerradas: só a mensagem os identifica.
const UNAVAILABLE_MESSAGE = /timeout|connection terminated/i;

function isUnavailable(err) {
  return (
    NETWORK_ERROR_CODES.has(err.code) ||
    UNAVAILABLE_SQLSTATE.test(err.code ?? '') ||
    UNAVAILABLE_MESSAGE.test(err.message ?? '')
  );
}

module.exports = {
  AppError,
  invalidRequest,
  invalidCpf,
  customerNotFound,
  inactiveCustomer,
  invalidCredentials,
  invalidRefreshToken,
  routeNotFound,
  internalError,
  serviceUnavailable,
  isUnavailable,
};
