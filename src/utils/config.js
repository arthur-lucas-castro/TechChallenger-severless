/** Lê um inteiro positivo do ambiente. Um valor inválido é erro de configuração, não um padrão. */
function positiveIntEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`A variável de ambiente ${name} deve ser um inteiro positivo.`);
  }
  return value;
}

module.exports = { positiveIntEnv };
