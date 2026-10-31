const { positiveIntEnv } = require('../../../src/utils/config');

describe('positiveIntEnv', () => {
  afterEach(() => {
    delete process.env.TESTE_VALOR;
  });

  it.each([undefined, ''])('usa o padrão quando o valor é %j', (value) => {
    if (value !== undefined) process.env.TESTE_VALOR = value;

    expect(positiveIntEnv('TESTE_VALOR', 10)).toBe(10);
  });

  it('lê um inteiro positivo', () => {
    process.env.TESTE_VALOR = '60';

    expect(positiveIntEnv('TESTE_VALOR', 10)).toBe(60);
  });

  it.each(['abc', '0', '-1', '2.5'])('recusa %s citando a variável', (value) => {
    process.env.TESTE_VALOR = value;

    expect(() => positiveIntEnv('TESTE_VALOR', 10)).toThrow('TESTE_VALOR');
  });
});
