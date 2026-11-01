const { createLogger } = require('../../../src/utils/logger');
const { generateCpf, formatCpf } = require('../../helpers/cpf');

describe('createLogger', () => {
  let stdout;

  const lastLine = () => JSON.parse(stdout.mock.calls.at(-1)[0]);

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  it('escreve uma linha JSON com os campos de correlação', () => {
    createLogger({ requestId: 'r1', route: 'POST /auth' }).info('ok', { status: 200 });

    expect(lastLine()).toEqual({
      timestamp: expect.any(String),
      level: 'info',
      service: 'techchallenger-auth',
      message: 'ok',
      requestId: 'r1',
      route: 'POST /auth',
      status: 200,
    });
    expect(stdout.mock.calls[0][0].endsWith('\n')).toBe(true);
  });

  it.each(['warn', 'error'])('grava o nível %s', (level) => {
    createLogger()[level]('mensagem');

    expect(lastLine().level).toBe(level);
  });

  it('mantém nas linhas seguintes os campos de add()', () => {
    const log = createLogger();
    log.add({ clienteId: 7 });
    log.info('primeira');
    expect(lastLine().clienteId).toBe(7);
    log.info('segunda');
    expect(lastLine().clienteId).toBe(7);
  });

  it.each(['refreshToken', 'accessToken', 'token', 'authorization', 'password', 'jwtSecret'])(
    'oculta o campo %s',
    (key) => {
      createLogger().info('m', { [key]: 'valor-sensivel' });

      expect(lastLine()[key]).toBe('[REDACTED]');
    },
  );

  it('mascara CPF com e sem pontuação dentro de textos', () => {
    const cpf = generateCpf();

    createLogger().error('falha', { a: `cpf ${cpf} aqui`, b: `cpf ${formatCpf(cpf)} aqui` });

    const line = lastLine();
    expect(line.a).toBe('cpf ***.456.789-** aqui');
    expect(line.b).toBe('cpf ***.456.789-** aqui');
  });

  it('remove JWT e token opaco de textos', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiJ9.c2lnbmF0dXJl';
    const opaque = 'd'.repeat(43);

    createLogger().error(`falha ${jwt}`, { errorMessage: `valor ${opaque} recusado` });

    const line = lastLine();
    expect(line.message).toBe('falha [REDACTED]');
    expect(line.errorMessage).toBe('valor [REDACTED] recusado');
  });

  it('preserva números e identificadores curtos', () => {
    createLogger().info('m', { requestId: 'c6af9ac6-7b61-11e6', status: 200, durationMs: 12 });

    expect(lastLine()).toMatchObject({
      requestId: 'c6af9ac6-7b61-11e6',
      status: 200,
      durationMs: 12,
    });
  });
});
