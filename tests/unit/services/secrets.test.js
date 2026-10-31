const mockSend = jest.fn();

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({ send: mockSend })),
  GetParametersCommand: jest.fn((input) => input),
}));

const JWT_SECRET = 'x'.repeat(48);

function ssmResponse(overrides = {}) {
  return {
    Parameters: [
      { Name: '/jwt/secret', Value: JWT_SECRET },
      { Name: '/db/host', Value: 'rds.local' },
      { Name: '/db/name', Value: 'oficina' },
      { Name: '/db/username', Value: 'lambda' },
      { Name: '/db/password', Value: 'senha-de-teste' },
    ],
    InvalidParameters: [],
    ...overrides,
  };
}

describe('getSecrets', () => {
  let getSecrets;

  beforeEach(() => {
    process.env.JWT_SECRET_PARAM = '/jwt/secret';
    process.env.DB_PARAM_PREFIX = '/db';
    jest.isolateModules(() => {
      ({ getSecrets } = require('../../../src/services/secrets'));
    });
  });

  afterEach(() => {
    delete process.env.JWT_SECRET_PARAM;
    delete process.env.DB_PARAM_PREFIX;
  });

  it('lê os parâmetros com descriptografia', async () => {
    mockSend.mockResolvedValue(ssmResponse());

    await expect(getSecrets()).resolves.toEqual({
      jwtSecret: JWT_SECRET,
      db: { host: 'rds.local', database: 'oficina', user: 'lambda', password: 'senha-de-teste' },
    });
    expect(mockSend.mock.calls[0][0]).toEqual({
      Names: ['/jwt/secret', '/db/host', '/db/name', '/db/username', '/db/password'],
      WithDecryption: true,
    });
  });

  it('consulta o SSM uma vez só entre invocações', async () => {
    mockSend.mockResolvedValue(ssmResponse());

    await getSecrets();
    await getSecrets();

    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('tenta de novo depois de uma falha', async () => {
    mockSend.mockRejectedValueOnce(new Error('SSM fora'));
    mockSend.mockResolvedValueOnce(ssmResponse());

    await expect(getSecrets()).rejects.toThrow('SSM fora');
    await expect(getSecrets()).resolves.toMatchObject({ jwtSecret: JWT_SECRET });
  });

  it.each(['JWT_SECRET_PARAM', 'DB_PARAM_PREFIX'])('falha sem a variável %s', async (name) => {
    delete process.env[name];
    await expect(getSecrets()).rejects.toThrow(name);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('falha quando um parâmetro não existe, citando só o nome', async () => {
    mockSend.mockResolvedValue(ssmResponse({ InvalidParameters: ['/db/host'] }));
    await expect(getSecrets()).rejects.toThrow('/db/host');
  });

  it('recusa segredo com menos de 32 bytes', async () => {
    mockSend.mockResolvedValue(
      ssmResponse({ Parameters: [{ Name: '/jwt/secret', Value: 'curto' }] }),
    );
    await expect(getSecrets()).rejects.toThrow('32 bytes');
  });
});
