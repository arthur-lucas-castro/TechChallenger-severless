// datadog-lambda-js e dd-trace só existem no layer da Lambda; aqui entram como módulos virtuais.
// Sem valor, a factory lança erro, como o require de um módulo ausente.
function virtualModule(name, value) {
  jest.doMock(
    name,
    () => {
      if (value === undefined) {
        throw new Error(`Cannot find module '${name}'`);
      }
      return value;
    },
    { virtual: true },
  );
}

// resetModules descarta também as instâncias dos módulos virtuais do teste anterior.
function loadWith({ library, tracer } = {}) {
  jest.resetModules();
  virtualModule('datadog-lambda-js', library);
  virtualModule('dd-trace', tracer);
  return require('../../../src/utils/datadog');
}

function tracerWithSpan(span) {
  return { scope: () => ({ active: () => span }) };
}

describe('datadog', () => {
  describe('recordIntegrationFailure', () => {
    it('envia a distribution com as tags normalizadas', () => {
      const library = { sendDistributionMetric: jest.fn() };
      const datadog = loadWith({ library });

      datadog.recordIntegrationFailure('POST /auth/login', 'indisponivel');

      expect(library.sendDistributionMetric).toHaveBeenCalledWith(
        'oficina.integracao.falha',
        1,
        'integracao:lambda_auth',
        'operacao:post_/auth/login',
        'causa:indisponivel',
      );
    });

    it('não faz nada sem a biblioteca do layer', () => {
      const datadog = loadWith();

      expect(() => datadog.recordIntegrationFailure('POST /auth', 'erro_interno')).not.toThrow();
    });

    it('não propaga erro da biblioteca', () => {
      const library = {
        sendDistributionMetric: jest.fn(() => {
          throw new Error('extensão indisponível');
        }),
      };
      const datadog = loadWith({ library });

      expect(() => datadog.recordIntegrationFailure('POST /auth', 'erro_interno')).not.toThrow();
    });
  });

  describe('traceContext', () => {
    it('devolve os ids do span ativo', () => {
      const span = { context: () => ({ toTraceId: () => '111', toSpanId: () => '222' }) };
      const datadog = loadWith({ tracer: tracerWithSpan(span) });

      expect(datadog.traceContext()).toEqual({ dd: { trace_id: '111', span_id: '222' } });
    });

    it('devolve vazio sem span ativo', () => {
      const datadog = loadWith({ tracer: tracerWithSpan(null) });

      expect(datadog.traceContext()).toEqual({});
    });

    it('devolve vazio sem o tracer do layer', () => {
      const datadog = loadWith();

      expect(datadog.traceContext()).toEqual({});
    });
  });
});
