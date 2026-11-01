jest.mock('../../../src/services/db');

const db = require('../../../src/services/db');
const { findByCpf, canAuthenticate } = require('../../../src/services/customerRepository');
const { generateCpf } = require('../../helpers/cpf');

describe('customerRepository', () => {
  const cpf = generateCpf();

  it('devolve o cliente encontrado', async () => {
    const customer = { id: 42, nome: 'Fulano', status: 'ATIVO' };
    db.query.mockResolvedValue({ rows: [customer] });

    await expect(findByCpf(cpf)).resolves.toEqual(customer);
  });

  it('passa o CPF como parâmetro, nunca concatenado no SQL', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await findByCpf(cpf);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('numerodocumento = $1');
    expect(sql).not.toContain(cpf);
    expect(params).toEqual([cpf]);
  });

  it('devolve null quando não encontra', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await expect(findByCpf(cpf)).resolves.toBeNull();
  });

  it('propaga erro do banco', async () => {
    db.query.mockRejectedValue(new Error('banco fora'));

    await expect(findByCpf(cpf)).rejects.toThrow('banco fora');
  });

  it('só autentica status ATIVO', () => {
    expect(canAuthenticate('ATIVO')).toBe(true);
    expect(canAuthenticate('INATIVO')).toBe(false);
    expect(canAuthenticate('BLOQUEADO')).toBe(false);
    expect(canAuthenticate('QUALQUER_OUTRO')).toBe(false);
    expect(canAuthenticate(undefined)).toBe(false);
  });
});
