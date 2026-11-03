jest.mock('../../../src/utils/datadog', () => ({
  recordIntegrationFailure: jest.fn(),
  traceContext: jest.fn(() => ({})),
}));

const { recordIntegrationFailure } = require('../../../src/utils/datadog');
const { AppError } = require('../../../src/utils/errors');
const { withHttp } = require('../../../src/utils/http');
const { httpEvent, lambdaContext } = require('../../helpers/event');

describe('withHttp', () => {
  let stdout;

  const logLines = () => stdout.mock.calls.map(([line]) => JSON.parse(line));

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  it('registra falha de integração indisponível e responde 503', async () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const handler = withHttp('POST /auth', async () => {
      throw err;
    });

    const response = await handler(httpEvent('POST /auth', {}), lambdaContext);

    expect(response.statusCode).toBe(503);
    expect(recordIntegrationFailure).toHaveBeenCalledWith('POST /auth', 'indisponivel');
  });

  it('registra erro interno e responde 500', async () => {
    const handler = withHttp('POST /auth/login', async () => {
      throw new TypeError('quebrou');
    });

    const response = await handler(httpEvent('POST /auth/login', {}), lambdaContext);

    expect(response.statusCode).toBe(500);
    expect(recordIntegrationFailure).toHaveBeenCalledWith('POST /auth/login', 'erro_interno');
  });

  it('não registra falha para recusa prevista do contrato', async () => {
    const handler = withHttp('POST /auth', async () => {
      throw new AppError(404, 'CLIENTE_NAO_ENCONTRADO', 'Cliente não encontrado.');
    });

    const response = await handler(httpEvent('POST /auth', {}), lambdaContext);

    expect(response.statusCode).toBe(404);
    expect(recordIntegrationFailure).not.toHaveBeenCalled();
  });

  it('grava o requestId do API Gateway também como correlationId', async () => {
    const handler = withHttp('POST /auth', async () => ({ statusCode: 204 }));

    await handler(httpEvent('POST /auth', {}), lambdaContext);

    expect(logLines().at(-1)).toMatchObject({
      requestId: 'req-teste',
      correlationId: 'req-teste',
      awsRequestId: 'aws-req-teste',
    });
  });
});
