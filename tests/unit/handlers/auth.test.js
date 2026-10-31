jest.mock('../../../src/services/customerRepository');

const customerRepository = require('../../../src/services/customerRepository');
const { handler } = require('../../../src/handlers/auth');
const { generateCpf, formatCpf } = require('../../helpers/cpf');
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

  it('responde 404 quando o cliente não existe', async () => {
    customerRepository.findByCpf.mockResolvedValue(null);

    const event = httpEvent(ROUTE, { cpf: generateCpf() });
    const { status, body } = parse(await handler(event, lambdaContext));

    expect(status).toBe(404);
    expect(body.code).toBe('CLIENTE_NAO_ENCONTRADO');
  });

  it.each(['INATIVO', 'BLOQUEADO'])('responde 403 para cliente %s', async (customerStatus) => {
    customerRepository.findByCpf.mockResolvedValue({ id: 1, nome: 'F', status: customerStatus });
    customerRepository.canAuthenticate.mockReturnValue(false);

    const event = httpEvent(ROUTE, { cpf: generateCpf() });
    const { status, body } = parse(await handler(event, lambdaContext));

    expect(status).toBe(403);
    expect(body.code).toBe('CLIENTE_INATIVO');
  });

  it('busca o cliente pelo CPF normalizado', async () => {
    customerRepository.findByCpf.mockResolvedValue(null);
    const cpf = generateCpf();

    await handler(httpEvent(ROUTE, { cpf: formatCpf(cpf) }), lambdaContext);

    expect(customerRepository.findByCpf).toHaveBeenCalledWith(cpf);
  });

  it('responde 503 sem detalhes quando o banco está indisponível', async () => {
    customerRepository.findByCpf.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' }),
    );

    const response = await handler(httpEvent(ROUTE, { cpf: generateCpf() }), lambdaContext);

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).code).toBe('SERVICO_INDISPONIVEL');
    expect(response.body).not.toContain('10.0.0.1');
  });

  it('responde 500 sem detalhes para erro inesperado', async () => {
    customerRepository.findByCpf.mockRejectedValue(new Error('relation "cliente" does not exist'));

    const response = await handler(httpEvent(ROUTE, { cpf: generateCpf() }), lambdaContext);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).code).toBe('ERRO_INTERNO');
    expect(response.body).not.toContain('relation');
  });

  it('entende body em Base64', async () => {
    const event = httpEvent(ROUTE, undefined, {
      body: Buffer.from('{"cpf":"123"}').toString('base64'),
      isBase64Encoded: true,
    });
    const { body } = parse(await handler(event, lambdaContext));
    expect(body.code).toBe('CPF_INVALIDO');
  });
});
