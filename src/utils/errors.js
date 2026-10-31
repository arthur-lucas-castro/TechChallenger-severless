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

const routeNotFound = () => new AppError(404, 'ROTA_NAO_ENCONTRADA', 'Rota não encontrada.');

const internalError = () =>
  new AppError(500, 'ERRO_INTERNO', 'Erro interno. Tente novamente mais tarde.');

module.exports = { AppError, invalidRequest, invalidCpf, routeNotFound, internalError };
