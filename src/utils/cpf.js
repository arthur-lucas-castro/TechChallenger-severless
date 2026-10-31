const CPF_LENGTH = 11;
const MAX_INPUT_LENGTH = 32;

class CpfError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'CpfError';
    this.reason = reason;
  }
}

function checkDigit(digits, firstWeight) {
  const sum = [...digits].reduce((total, digit, i) => total + Number(digit) * (firstWeight - i), 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** Devolve o CPF só com dígitos ou lança CpfError explicando o motivo. */
function normalizeCpf(value) {
  if (typeof value !== 'string') {
    throw new CpfError('TIPO_INVALIDO', 'O CPF deve ser uma string.');
  }
  if (value.trim() === '') {
    throw new CpfError('VAZIO', 'O CPF é obrigatório.');
  }
  if (value.length > MAX_INPUT_LENGTH) {
    throw new CpfError('TAMANHO_INVALIDO', 'O CPF deve ter 11 dígitos.');
  }

  // Mesma normalização do value object Documento da API, que grava só os dígitos.
  const cpf = value.replace(/\D/g, '');

  if (cpf.length !== CPF_LENGTH) {
    throw new CpfError('TAMANHO_INVALIDO', 'O CPF deve ter 11 dígitos.');
  }
  if (/^(\d)\1+$/.test(cpf)) {
    throw new CpfError('DIGITOS_REPETIDOS', 'O CPF não pode ter todos os dígitos iguais.');
  }
  if (
    checkDigit(cpf.slice(0, 9), 10) !== Number(cpf[9]) ||
    checkDigit(cpf.slice(0, 10), 11) !== Number(cpf[10])
  ) {
    throw new CpfError('DIGITO_VERIFICADOR_INVALIDO', 'Os dígitos verificadores não conferem.');
  }

  return cpf;
}

/** Máscara para logs: 12345678909 vira ***.456.789-**. */
function maskCpf(value) {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  if (digits.length !== CPF_LENGTH) {
    return '***.***.***-**';
  }
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
}

module.exports = { CpfError, normalizeCpf, maskCpf };
