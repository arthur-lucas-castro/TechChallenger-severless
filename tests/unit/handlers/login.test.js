jest.mock('../../../src/services/refreshTokenService');
jest.mock('../../../src/services/tokenService');
jest.mock('../../../src/services/userRepository');

const refreshTokenService = require('../../../src/services/refreshTokenService');
const tokenService = require('../../../src/services/tokenService');
const userRepository = require('../../../src/services/userRepository');
const { handler } = require('../../../src/handlers/login');
const { httpEvent, lambdaContext } = require('../../helpers/event');

const ROUTE = 'POST /auth/login';
const CREDENTIALS = { email: 'usuario@exemplo.com', senha: 'senha-ficticia' };

describe('POST /auth/login', () => {
  let stdout;

  const output = () => stdout.mock.calls.map(([line]) => line).join('');

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    tokenService.signAccessToken.mockResolvedValue({ accessToken: 'jwt', expiresIn: 900 });
    refreshTokenService.createSession.mockResolvedValue({
      refreshToken: 'opaco',
      refreshExpiresIn: 604800,
      familyId: 'familia-1',
    });
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  it.each(['Adm', 'Funcionario'])('responde 200 com o par de tokens para %s', async (tipo) => {
    userRepository.verifyCredentials.mockResolvedValue({ id: 3, tipo });

    const response = await handler(httpEvent(ROUTE, CREDENTIALS), lambdaContext);

    expect(response.statusCode).toBe(200);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(JSON.parse(response.body)).toEqual({
      accessToken: 'jwt',
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshToken: 'opaco',
      refreshExpiresIn: 604800,
    });
    expect(tokenService.signAccessToken).toHaveBeenCalledWith({ id: 3, role: tipo });
    expect(refreshTokenService.createSession).toHaveBeenCalledWith({ usuarioId: 3 });
  });

  it('responde 401 sem revelar se o erro foi o e-mail ou a senha', async () => {
    userRepository.verifyCredentials.mockResolvedValue(null);

    const response = await handler(httpEvent(ROUTE, CREDENTIALS), lambdaContext);

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      code: 'CREDENCIAIS_INVALIDAS',
      message: 'E-mail ou senha inválidos.',
      requestId: 'req-teste',
    });
    expect(refreshTokenService.createSession).not.toHaveBeenCalled();
  });

  it.each([
    ['sem email', { senha: 'x' }],
    ['sem senha', { email: 'a@b.com' }],
    ['senha que não é string', { email: 'a@b.com', senha: 123 }],
  ])('responde 400 %s', async (_, body) => {
    const response = await handler(httpEvent(ROUTE, body), lambdaContext);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).code).toBe('REQUISICAO_INVALIDA');
    expect(userRepository.verifyCredentials).not.toHaveBeenCalled();
  });

  it('responde 503 quando o banco está indisponível', async () => {
    userRepository.verifyCredentials.mockRejectedValue(
      Object.assign(new Error('falhou'), { code: 'ECONNREFUSED' }),
    );

    const response = await handler(httpEvent(ROUTE, CREDENTIALS), lambdaContext);

    expect(response.statusCode).toBe(503);
  });

  it('não registra e-mail, senha nem tokens no log', async () => {
    userRepository.verifyCredentials.mockResolvedValue({ id: 3, tipo: 'Adm' });

    await handler(httpEvent(ROUTE, CREDENTIALS), lambdaContext);

    expect(JSON.parse(output())).toMatchObject({ usuarioId: 3, status: 200 });
    expect(output()).not.toContain(CREDENTIALS.email);
    expect(output()).not.toContain(CREDENTIALS.senha);
    expect(output()).not.toContain('opaco');
  });
});
