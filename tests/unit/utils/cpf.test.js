const { CpfError, normalizeCpf, maskCpf } = require('../../../src/utils/cpf');
const { generateCpf, formatCpf } = require('../../helpers/cpf');

const BASES = ['123456789', '987654321', '111222333', '000000019', '529982247'];

function reasonOf(value) {
  try {
    normalizeCpf(value);
  } catch (err) {
    expect(err).toBeInstanceOf(CpfError);
    return err.reason;
  }
  throw new Error('deveria ter rejeitado o CPF');
}

describe('normalizeCpf', () => {
  it.each(BASES)('aceita CPF gerado sem máscara (base %s)', (base) => {
    const cpf = generateCpf(base);
    expect(normalizeCpf(cpf)).toBe(cpf);
  });

  it.each(BASES)('aceita CPF gerado com máscara e devolve só os dígitos (base %s)', (base) => {
    const cpf = generateCpf(base);
    expect(normalizeCpf(formatCpf(cpf))).toBe(cpf);
  });

  it('rejeita o primeiro dígito verificador errado', () => {
    const cpf = generateCpf();
    const wrong = `${cpf.slice(0, 9)}${(Number(cpf[9]) + 1) % 10}${cpf[10]}`;
    expect(reasonOf(wrong)).toBe('DIGITO_VERIFICADOR_INVALIDO');
  });

  it('rejeita o segundo dígito verificador errado', () => {
    const cpf = generateCpf();
    const wrong = `${cpf.slice(0, 10)}${(Number(cpf[10]) + 1) % 10}`;
    expect(reasonOf(wrong)).toBe('DIGITO_VERIFICADOR_INVALIDO');
  });

  it.each(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])(
    'rejeita sequência repetida do dígito %s',
    (d) => {
      expect(reasonOf(d.repeat(11))).toBe('DIGITOS_REPETIDOS');
    },
  );

  it.each(['123', '123456789012', '12345678901234'])('rejeita tamanho errado (%s)', (value) => {
    expect(reasonOf(value)).toBe('TAMANHO_INVALIDO');
  });

  it('rejeita entrada longa demais antes de processar', () => {
    expect(reasonOf('1'.repeat(1000))).toBe('TAMANHO_INVALIDO');
  });

  it.each(['', '   '])('rejeita valor vazio (%j)', (value) => {
    expect(reasonOf(value)).toBe('VAZIO');
  });

  it.each([[undefined], [null], [12345678909], [{}], [[]], [true]])(
    'rejeita tipo errado (%j)',
    (value) => {
      expect(reasonOf(value)).toBe('TIPO_INVALIDO');
    },
  );
});

describe('maskCpf', () => {
  it('mantém só os dígitos do meio', () => {
    expect(maskCpf('12345678909')).toBe('***.456.789-**');
  });

  it('aceita CPF com máscara', () => {
    expect(maskCpf('123.456.789-09')).toBe('***.456.789-**');
  });

  it.each(['123', '', undefined, null, 123])('não revela nada de valor inválido (%j)', (value) => {
    expect(maskCpf(value)).toBe('***.***.***-**');
  });
});
