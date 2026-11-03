/**
 * Integração opcional com o Datadog. `datadog-lambda-js` e `dd-trace` vêm do layer
 * Datadog-Node20-x (/opt/nodejs/node_modules), e não deste pacote: ficam fora do bundle
 * (scripts/package.js). Fora da Lambda com o layer (testes, execução local) não existem,
 * e as funções abaixo não fazem nada.
 */

const NOT_LOADED = Symbol('not-loaded');
let lambdaLibrary = NOT_LOADED;
let tracer = NOT_LOADED;

function loadLambdaLibrary() {
  if (lambdaLibrary === NOT_LOADED) {
    try {
      lambdaLibrary = require('datadog-lambda-js');
    } catch {
      lambdaLibrary = null;
    }
  }
  return lambdaLibrary;
}

function loadTracer() {
  if (tracer === NOT_LOADED) {
    try {
      tracer = require('dd-trace');
    } catch {
      tracer = null;
    }
  }
  return tracer;
}

/** Tag no formato do Datadog: minúsculas, sem espaços, e "/" preservada (ex.: post_/auth/login). */
function tagValue(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, '_');
}

/**
 * `oficina.integracao.falha` (distribution, valor 1): erro técnico na autenticação, como
 * banco ou SSM indisponíveis. Recusas previstas (CPF inválido, cliente inativo) não contam.
 * A API envia a mesma métrica para SMTP e banco.
 */
function recordIntegrationFailure(route, cause) {
  const library = loadLambdaLibrary();
  if (!library) {
    return;
  }
  try {
    library.sendDistributionMetric(
      'oficina.integracao.falha',
      1,
      'integracao:lambda_auth',
      `operacao:${tagValue(route)}`,
      `causa:${tagValue(cause)}`,
    );
  } catch {
    // Métrica é acessória: nunca derruba a requisição.
  }
}

/** Ids do span ativo, para o Datadog ligar o log ao trace. Vazio sem tracer ou sem span. */
function traceContext() {
  const span = loadTracer()?.scope?.().active();
  if (!span) {
    return {};
  }
  const context = span.context();
  return { dd: { trace_id: context.toTraceId(), span_id: context.toSpanId() } };
}

module.exports = { recordIntegrationFailure, traceContext };
