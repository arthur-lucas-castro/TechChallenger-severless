const { handler } = require('../../src/index');

describe('roteador', () => {
  it('responde 404 para rota desconhecida', async () => {
    const response = await handler({ routeKey: 'GET /nada' }, {});
    expect(response.statusCode).toBe(404);
  });
});
