const { isUnavailable } = require('../../../src/utils/errors');

describe('isUnavailable', () => {
  it.each([
    ['ECONNREFUSED'],
    ['ECONNRESET'],
    ['ETIMEDOUT'],
    ['ENOTFOUND'],
    ['08006'], // connection_failure
    ['53300'], // too_many_connections
    ['57P01'], // admin_shutdown
    ['57014'], // statement_timeout
  ])('considera indisponível o código %s', (code) => {
    expect(isUnavailable(Object.assign(new Error('falha'), { code }))).toBe(true);
  });

  it.each([
    ['timeout exceeded when trying to connect'],
    ['Connection terminated unexpectedly'],
    ['Query read timeout'],
  ])('considera indisponível a mensagem "%s"', (message) => {
    expect(isUnavailable(new Error(message))).toBe(true);
  });

  it.each([
    ['42P01', 'relation "cliente" does not exist'],
    ['28P01', 'password authentication failed'],
    ['23505', 'duplicate key value'],
    [undefined, 'erro de programação'],
  ])('não considera indisponível %s', (code, message) => {
    expect(isUnavailable(Object.assign(new Error(message), { code }))).toBe(false);
  });
});
