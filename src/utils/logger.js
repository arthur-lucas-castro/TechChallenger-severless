const SERVICE = 'techchallenger-auth';

/**
 * Escreve direto no stdout, e não no console.log, porque o console do runtime prefixa cada linha
 * com data e requestId e o log deixaria de ser JSON puro para o Datadog.
 */
function write(level, message, fields) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE,
    message,
    ...fields,
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
