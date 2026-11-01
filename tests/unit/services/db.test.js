const mockPool = { on: jest.fn(), query: jest.fn(), connect: jest.fn() };
const mockPoolConstructor = jest.fn(() => mockPool);
const mockGetSecrets = jest.fn();

jest.mock('pg', () => ({ Pool: mockPoolConstructor }));
jest.mock('../../../src/services/secrets', () => ({ getSecrets: mockGetSecrets }));

const DB = { host: 'rds.local', database: 'oficina', user: 'lambda', password: 'senha-de-teste' };

describe('db', () => {
  let db;
  let client;

  beforeEach(() => {
    mockGetSecrets.mockResolvedValue({ db: DB });
    client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    mockPool.connect.mockResolvedValue(client);
    jest.isolateModules(() => {
      db = require('../../../src/services/db');
    });
  });

  afterEach(() => {
    delete process.env.DB_SSL;
    delete process.env.DB_POOL_MAX;
  });

  it('cria um pool de tamanho 1 com TLS verificado por padrão', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await db.query('SELECT 1');

    expect(mockPoolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        ...DB,
        port: 5432,
        max: 1,
        ssl: { rejectUnauthorized: true },
      }),
    );
  });

  it('respeita DB_SSL=false e DB_POOL_MAX', async () => {
    process.env.DB_SSL = 'false';
    process.env.DB_POOL_MAX = '2';
    mockPool.query.mockResolvedValue({ rows: [] });

    await db.query('SELECT 1');

    expect(mockPoolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: false, max: 2 }),
    );
  });

  it('reutiliza o pool entre invocações', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await db.query('SELECT 1');
    await db.query('SELECT 2');

    expect(mockPoolConstructor).toHaveBeenCalledTimes(1);
  });

  it('tenta criar o pool de novo se a leitura dos segredos falhar', async () => {
    mockGetSecrets.mockRejectedValueOnce(new Error('SSM fora'));
    mockPool.query.mockResolvedValue({ rows: [] });

    await expect(db.query('SELECT 1')).rejects.toThrow('SSM fora');
    await expect(db.query('SELECT 1')).resolves.toEqual({ rows: [] });
  });

  it('registra listener de erro para conexões ociosas', async () => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockPool.query.mockResolvedValue({ rows: [] });

    await db.query('SELECT 1');
    const [event, listener] = mockPool.on.mock.calls[0];
    listener(Object.assign(new Error('caiu'), { code: 'ECONNRESET' }));

    expect(event).toBe('error');
    expect(stdout.mock.calls[0][0]).toContain('ECONNRESET');
    stdout.mockRestore();
  });

  describe('withTransaction', () => {
    const statements = () => client.query.mock.calls.map(([sql]) => sql);

    it('confirma e devolve a conexão', async () => {
      await expect(db.withTransaction(async () => 'ok')).resolves.toBe('ok');

      expect(statements()).toEqual(['BEGIN', 'COMMIT']);
      expect(client.release).toHaveBeenCalledWith(undefined);
    });

    it('desfaz e descarta a conexão quando há erro', async () => {
      const failure = new Error('falhou');

      await expect(
        db.withTransaction(async () => {
          throw failure;
        }),
      ).rejects.toThrow(failure);

      expect(statements()).toEqual(['BEGIN', 'ROLLBACK']);
      expect(client.release).toHaveBeenCalledWith(failure);
    });

    it('preserva o erro original se o ROLLBACK também falhar', async () => {
      const failure = new Error('falhou');
      client.query.mockImplementation(async (sql) => {
        if (sql === 'ROLLBACK') throw new Error('conexão perdida');
        return {};
      });

      await expect(
        db.withTransaction(async () => {
          throw failure;
        }),
      ).rejects.toThrow(failure);
    });
  });
});
