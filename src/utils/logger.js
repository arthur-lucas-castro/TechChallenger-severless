const { maskCpf } = require('./cpf');

const SERVICE = 'techchallenger-auth';

const SENSITIVE_KEY = /token|authorization|password|senha|secret/i;
const JWT_VALUE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const OPAQUE_TOKEN_VALUE = /(?<![\w-])[\w-]{43}(?![\w-])/g;
const CPF_VALUE = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g;

function scrub(text) {
  return text
    .replace(JWT_VALUE, '[REDACTED]')
    .replace(OPAQUE_TOKEN_VALUE, '[REDACTED]')
    .replace(CPF_VALUE, maskCpf);
}

// Última barreira: mensagens e stacks de erro vêm de bibliotecas e podem repetir valores da query.
function sanitize(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (SENSITIVE_KEY.test(key)) {
        return [key, '[REDACTED]'];
      }
      return [key, typeof value === 'string' ? scrub(value) : value];
    }),
  );
}

/**
 * Escreve direto no stdout, e não no console.log, porque o console do runtime prefixa cada linha
 * com data e requestId e o log deixaria de ser JSON puro para o Datadog.
 */
function write(level, message, fields) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE,
    message: scrub(message),
    ...sanitize(fields),
  };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function createLogger(baseFields = {}) {
  let fields = { ...baseFields };
  return {
    /** Acrescenta campos a todas as próximas linhas desta requisição. */
    add(extra) {
      fields = { ...fields, ...extra };
    },
    info: (message, extra) => write('info', message, { ...fields, ...extra }),
    warn: (message, extra) => write('warn', message, { ...fields, ...extra }),
    error: (message, extra) => write('error', message, { ...fields, ...extra }),
  };
}

module.exports = { createLogger };
