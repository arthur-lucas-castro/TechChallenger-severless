const { AppError, invalidRequest, internalError } = require('./errors');
const { createLogger } = require('./logger');

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(statusCode, body) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

function noContent() {
  return { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };
}

/** Devolve o body como objeto ou lança 400 para body ausente, JSON malformado ou não objeto. */
function parseJsonBody(event) {
  if (!event.body) {
    throw invalidRequest('BODY_AUSENTE');
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw invalidRequest('JSON_MALFORMADO');
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidRequest('BODY_NAO_OBJETO');
  }
  return body;
}

/** Lê um campo string obrigatório do body. */
function requireString(body, field) {
  if (typeof body[field] !== 'string' || body[field] === '') {
    throw invalidRequest(`CAMPO_INVALIDO_${field}`);
  }
  return body[field];
}

function toAppError(err, log) {
  if (err instanceof AppError) {
    return err;
  }
  log.error('Erro não tratado', {
    errorName: err.name,
    errorCode: err.code,
    errorMessage: err.message,
    stack: err.stack,
  });
  return internalError();
}

/** Tratamento comum: log de fim de requisição e tradução de erros para o contrato HTTP. */
function withHttp(routeKey, fn) {
  return async (event, context) => {
    const startedAt = Date.now();
    const requestId = event.requestContext?.requestId;
    const log = createLogger({
      requestId,
      awsRequestId: context?.awsRequestId,
      route: routeKey,
    });

    let response;
    try {
      response = await fn(event, log);
    } catch (err) {
      const appError = toAppError(err, log);
      if (appError.reason) {
        log.add({ reason: appError.reason });
      }
      response = json(appError.statusCode, {
        code: appError.code,
        message: appError.message,
        requestId,
      });
    }

    log.info('Requisição concluída', {
      status: response.statusCode,
      durationMs: Date.now() - startedAt,
    });
    return response;
  };
}

module.exports = { json, noContent, parseJsonBody, requireString, withHttp };
