jest.mock('../../../src/services/db');

const db = require('../../../src/services/db');
const { handler } = require('../../../src/handlers/logout');
const { httpEvent, lambdaContext } = require('../../helpers/event');

const ROUTE = 'POST /auth/logout';

describe('POST /auth/logout', () => {
  let stdout;

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  it('responde 204 sem corpo', async () => {
    db.query.mockResolvedValue({ rowCount: 1 });

    const response = await handler(
      httpEvent(ROUTE, { refreshToken: 'c'.repeat(43) }),
      lambdaContext,
    );

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('responde 204 mesmo quando o token não existe', async () => {
    db.query.mockResolvedValue({ rowCount: 0 });

    const response = await handler(
      httpEvent(ROUTE, { refreshToken: 'c'.repeat(43) }),
      lambdaContext,
    );

    expect(response.statusCode).toBe(204);
  });

  it('responde 400 sem refreshToken', async () => {
    const response = await handler(httpEvent(ROUTE, {}), lambdaContext);

    expect(response.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('responde 503 quando o banco está indisponível', async () => {
    db.query.mockRejectedValue(new Error('timeout exceeded when trying to connect'));

    const response = await handler(
      httpEvent(ROUTE, { refreshToken: 'c'.repeat(43) }),
      lambdaContext,
    );

    expect(response.statusCode).toBe(503);
  });
});
