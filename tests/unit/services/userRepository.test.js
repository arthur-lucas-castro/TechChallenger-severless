jest.mock('../../../src/services/db');

const bcrypt = require('bcryptjs');
const db = require('../../../src/services/db');
const { verifyCredentials } = require('../../../src/services/userRepository');

// Custo baixo só para o teste ser rápido. O prefixo $2a$ é o formato do BCrypt.Net usado pela API.
const SENHA = 'senha-ficticia';
const HASH = bcrypt.hashSync(SENHA, 4).replace(/^\$2b/, () => '$2a');

describe('verifyCredentials', () => {
  it('devolve id e tipo quando a senha confere, sem o hash', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 3, senhahash: HASH, tipo: 'Adm' }] });

    await expect(verifyCredentials('a@b.com', SENHA)).resolves.toEqual({ id: 3, tipo: 'Adm' });
  });

  it('procura pelo e-mail em minúsculas, como parâmetro', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await verifyCredentials('Fulano@Exemplo.COM', SENHA);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('email = $1');
    expect(sql).not.toContain('exemplo');
    expect(params).toEqual(['fulano@exemplo.com']);
  });

  it('devolve null para senha errada', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 3, senhahash: HASH, tipo: 'Adm' }] });

    await expect(verifyCredentials('a@b.com', 'outra-senha')).resolves.toBeNull();
  });

  it('devolve null para e-mail inexistente, passando pelo bcrypt', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const compare = jest.spyOn(bcrypt, 'compare');

    await expect(verifyCredentials('nao@existe.com', SENHA)).resolves.toBeNull();

    expect(compare).toHaveBeenCalledWith(SENHA, expect.stringMatching(/^\$2[ab]\$12\$/));
    compare.mockRestore();
  });

  it('propaga erro do banco', async () => {
    db.query.mockRejectedValue(new Error('banco fora'));

    await expect(verifyCredentials('a@b.com', SENHA)).rejects.toThrow('banco fora');
  });
});
