jest.mock('../../../src/services/db');
jest.mock('../../../src/services/tokenService');

const db = require('../../../src/services/db');
const tokenService = require('../../../src/services/tokenService');
const { handler } = require('../../../src/handlers/refresh');
const { httpEvent, lambdaContext } = require('../../helpers/event');

const ROUTE = 'POST /auth/refresh';
const REFRESH_TOKEN = 'b'.repeat(43);

function row(overrides = {}) {
  return {
    id: 'token-1',
    cliente_id: 7,
    familia_id: 'familia-1',
    usado_em: null,
    revogado_em: null,
    expirado: false,
    status: 'ATIVO',
    ...overrides,
  };
}

function givenStoredToken(stored) {
  const client = {
    query: jest.fn(async (sql) => {
      if (sql.includes('FOR UPDATE')) return { rows: stored ? [stored] : [] };
      if (sql.includes('INSERT INTO')) return { rows: [{ refresh_expires_in: 604800 }] };
      return { rows: [] };
    }),
  };
  db.withTransaction.mockImplementation((fn) => fn(client));
  return client;
}

const send = (body = { refreshToken: REFRESH_TOKEN }) =>
  handler(httpEvent(ROUTE, body), lambdaContext);

function expectRefused(response) {
  expect(response.statusCode).toBe(401);
  expect(JSON.parse(response.body)).toEqual({
    code: 'REFRESH_TOKEN_INVALIDO',
    message: 'Sessão inválida ou expirada. Faça login novamente.',
    requestId: 'req-teste',
  });
}

describe('POST /auth/refresh', () => {
  let stdout;

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    tokenService.signAccessToken.mockResolvedValue({ accessToken: 'jwt-novo', expiresIn: 900 });
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  it('responde 200 com rotação do token', async () => {
    const client = givenStoredToken(row());

    const response = await send();

    expect(response.statusCode).toBe(200);
    expect(response.headers['Cache-Control']).toBe('no-store');
    const body = JSON.parse(response.body);
    expect(body).toEqual({
      accessToken: 'jwt-novo',
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      refreshExpiresIn: 604800,
    });
    expect(body.refreshToken).not.toBe(REFRESH_TOKEN);
    expect(tokenService.signAccessToken).toHaveBeenCalledWith({ id: 7, role: 'cliente' });
    expect(client.query.mock.calls.some(([sql]) => sql.includes('substituido_por = $1'))).toBe(
      true,
    );
  });

  it.each([
    ['body vazio', {}],
    ['refreshToken que não é string', { refreshToken: 123 }],
    ['refreshToken vazio', { refreshToken: '' }],
  ])('responde 400 para %s', async (_, body) => {
    const response = await send(body);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).code).toBe('REQUISICAO_INVALIDA');
  });

  it('responde 400 para JSON malformado', async () => {
    const response = await handler(httpEvent(ROUTE, undefined, { body: '{' }), lambdaContext);

    expect(response.statusCode).toBe(400);
  });

  it('renova a sessão de um usuário com o perfil atual do banco', async () => {
    givenStoredToken(row({ cliente_id: null, usuario_id: 3, status: null, tipo: 'Funcionario' }));

    const response = await send();

    expect(response.statusCode).toBe(200);
    expect(tokenService.signAccessToken).toHaveBeenCalledWith({ id: 3, role: 'Funcionario' });
  });

  it('responde 401 para token inexistente', async () => {
    givenStoredToken(undefined);

    expectRefused(await send());
  });

  it('responde 401 para token malformado', async () => {
    expectRefused(await send({ refreshToken: 'nao-parece-um-token' }));
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('responde 401 para token expirado', async () => {
    givenStoredToken(row({ expirado: true }));

    expectRefused(await send());
  });

  it('responde 401 para token revogado', async () => {
    givenStoredToken(row({ revogado_em: new Date() }));

    expectRefused(await send());
  });

  it('no reuso, responde 401 e revoga a família', async () => {
    const client = givenStoredToken(row({ usado_em: new Date(), revogado_em: new Date() }));

    expectRefused(await send());

    const revoke = client.query.mock.calls.find(([sql]) => sql.includes('familia_id = $1'));
    expect(revoke[1]).toEqual(['familia-1']);
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
  });

  it('responde 403 quando o cliente deixou de estar ativo', async () => {
    givenStoredToken(row({ status: 'BLOQUEADO' }));

    const response = await send();

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).code).toBe('CLIENTE_INATIVO');
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
  });

  it('responde 503 quando o banco está indisponível', async () => {
    db.withTransaction.mockRejectedValue(
      Object.assign(new Error('too many clients'), { code: '53300' }),
    );

    const response = await send();

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).code).toBe('SERVICO_INDISPONIVEL');
  });

  it('responde 500 para outro erro de banco', async () => {
    db.withTransaction.mockRejectedValue(new Error('column x does not exist'));

    const response = await send();

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).code).toBe('ERRO_INTERNO');
    expect(response.body).not.toContain('column');
  });
});
