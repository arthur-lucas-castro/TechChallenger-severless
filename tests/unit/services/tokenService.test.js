jest.mock('../../../src/services/secrets');

const jwt = require('jsonwebtoken');
const { getSecrets } = require('../../../src/services/secrets');
const { signAccessToken } = require('../../../src/services/tokenService');
const { generateCpf } = require('../../helpers/cpf');

const SECRET = 'segredo-de-teste-com-mais-de-32-bytes!!';
const CLIENTE = { id: 42, role: 'cliente' };

describe('signAccessToken', () => {
  beforeEach(() => {
    getSecrets.mockResolvedValue({ jwtSecret: SECRET });
  });

  afterEach(() => {
    delete process.env.JWT_EXPIRES_IN_SECONDS;
    delete process.env.JWT_ISSUER;
    delete process.env.JWT_AUDIENCE;
    delete process.env.JWT_KID;
    jest.useRealTimers();
  });

  it('emite as claims do contrato', async () => {
    const { accessToken } = await signAccessToken(CLIENTE);
    const payload = jwt.verify(accessToken, SECRET);

    expect(payload).toEqual({
      sub: '42',
      role: 'cliente',
      type: 'access',
      iss: 'TechChallenger',
      aud: 'TechChallenger',
      iat: expect.any(Number),
      nbf: expect.any(Number),
      exp: expect.any(Number),
      jti: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(payload.nbf).toBe(payload.iat);
  });

  it.each(['Adm', 'Funcionario'])('emite o perfil %s', async (role) => {
    const { accessToken } = await signAccessToken({ id: 3, role });

    expect(jwt.verify(accessToken, SECRET)).toMatchObject({ sub: '3', role, type: 'access' });
  });

  it('usa HS256 e informa o kid no header', async () => {
    const { accessToken } = await signAccessToken(CLIENTE);

    expect(jwt.decode(accessToken, { complete: true }).header).toEqual({
      alg: 'HS256',
      typ: 'JWT',
      kid: 'v1',
    });
  });

  it('não coloca CPF no token', async () => {
    const { accessToken } = await signAccessToken(CLIENTE);

    expect(Object.keys(jwt.decode(accessToken))).not.toContain('cpf');
    expect(accessToken).not.toContain(generateCpf());
  });

  it('expira em 15 minutos por padrão', async () => {
    const { accessToken, expiresIn } = await signAccessToken(CLIENTE);
    const { iat, exp } = jwt.decode(accessToken);

    expect(expiresIn).toBe(900);
    expect(exp - iat).toBe(900);
  });

  it('respeita JWT_EXPIRES_IN_SECONDS', async () => {
    process.env.JWT_EXPIRES_IN_SECONDS = '60';

    const { accessToken, expiresIn } = await signAccessToken(CLIENTE);
    const { iat, exp } = jwt.decode(accessToken);

    expect(expiresIn).toBe(60);
    expect(exp - iat).toBe(60);
  });

  it.each(['abc', '0', '-5', '1.5'])('recusa JWT_EXPIRES_IN_SECONDS=%s', async (value) => {
    process.env.JWT_EXPIRES_IN_SECONDS = value;

    await expect(signAccessToken(CLIENTE)).rejects.toThrow('JWT_EXPIRES_IN_SECONDS');
  });

  it('respeita issuer, audience e kid do ambiente', async () => {
    process.env.JWT_ISSUER = 'outro-emissor';
    process.env.JWT_AUDIENCE = 'outra-api';
    process.env.JWT_KID = 'v2';

    const { accessToken } = await signAccessToken(CLIENTE);
    const { header, payload } = jwt.decode(accessToken, { complete: true });

    expect(payload).toMatchObject({ iss: 'outro-emissor', aud: 'outra-api' });
    expect(header.kid).toBe('v2');
  });

  it('gera um jti diferente a cada token', async () => {
    const first = await signAccessToken(CLIENTE);
    const second = await signAccessToken(CLIENTE);

    expect(jwt.decode(first.accessToken).jti).not.toBe(jwt.decode(second.accessToken).jti);
  });

  it('produz token que falha com outro segredo', async () => {
    const { accessToken } = await signAccessToken(CLIENTE);

    expect(() => jwt.verify(accessToken, 'outro-segredo-com-mais-de-32-bytes!!!')).toThrow(
      'invalid signature',
    );
  });

  it('produz token recusado depois de expirar', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const { accessToken } = await signAccessToken(CLIENTE);

    jest.setSystemTime(new Date('2026-01-01T00:15:01Z'));

    expect(() => jwt.verify(accessToken, SECRET)).toThrow('jwt expired');
  });

  it('falha quando o segredo não está disponível', async () => {
    getSecrets.mockRejectedValue(
      new Error('Variável de ambiente JWT_SECRET_PARAM não configurada.'),
    );

    await expect(signAccessToken(CLIENTE)).rejects.toThrow('JWT_SECRET_PARAM');
  });
});
