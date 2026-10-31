const { handler } = require('../../../src/handlers/auth');
const { httpEvent, lambdaContext } = require('../../helpers/event');

const ROUTE = 'POST /auth';

function parse(response) {
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

describe('POST /auth', () => {
  let stdout;

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  it.each([
    ['body ausente', httpEvent(ROUTE)],
    ['JSON malformado', httpEvent(ROUTE, undefined, { body: '{"cpf":' })],
    ['body que não é objeto', httpEvent(ROUTE, [1, 2])],
    ['body null', httpEvent(ROUTE, null)],
    ['campo cpf ausente', httpEvent(ROUTE, {})],
    ['cpf que não é string', httpEvent(ROUTE, { cpf: 12345678909 })],
  ])('responde 400 REQUISICAO_INVALIDA para %s', async (_, event) => {
    const { status, body } = parse(await handler(event, lambdaContext));
    expect(status).toBe(400);
    expect(body).toEqual({
      code: 'REQUISICAO_INVALIDA',
      message: 'O corpo da requisição é inválido.',
      requestId: 'req-teste',
    });
  });

  it.each(['123', '11111111111', '12345678900'])(
    'responde 400 CPF_INVALIDO para %s',
    async (cpf) => {
      const { status, body } = parse(await handler(httpEvent(ROUTE, { cpf }), lambdaContext));
      expect(status).toBe(400);
      expect(body.code).toBe('CPF_INVALIDO');
    },
  );

  it('entende body em Base64', async () => {
    const event = httpEvent(ROUTE, undefined, {
      body: Buffer.from('{"cpf":"123"}').toString('base64'),
      isBase64Encoded: true,
    });
    const { body } = parse(await handler(event, lambdaContext));
    expect(body.code).toBe('CPF_INVALIDO');
  });
});
