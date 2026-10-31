jest.mock('../../src/services/customerRepository');
jest.mock('../../src/services/refreshTokenService');
jest.mock('../../src/services/tokenService');

const { handler } = require('../../src/index');
const { httpEvent, lambdaContext } = require('../helpers/event');

describe('roteador', () => {
  let stdout;

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  it('responde 404 para rota desconhecida', async () => {
    const response = await handler(httpEvent('GET /nada'), lambdaContext);

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).code).toBe('ROTA_NAO_ENCONTRADA');
  });

  it.each(['POST /auth', 'POST /auth/refresh', 'POST /auth/logout'])(
    'encaminha %s ao handler da rota',
    async (routeKey) => {
      await handler(httpEvent(routeKey), lambdaContext);

      const logLine = JSON.parse(stdout.mock.calls[0][0]);
      expect(logLine.route).toBe(routeKey);
      expect(logLine.status).toBe(400);
    },
  );
});
