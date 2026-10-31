// Gera CPFs fictícios a partir de 9 dígitos quaisquer, sem reaproveitar src/utils/cpf.js:
// assim o teste não valida o algoritmo com ele mesmo. Nenhum CPF real é usado na suíte.
function digit(base) {
  const weightStart = base.length + 1;
  const sum = [...base].reduce((total, d, i) => total + Number(d) * (weightStart - i), 0);
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

function generateCpf(base = '123456789') {
  const first = digit(base);
  return `${base}${first}${digit(`${base}${first}`)}`;
}

function formatCpf(cpf) {
  return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

module.exports = { generateCpf, formatCpf };
