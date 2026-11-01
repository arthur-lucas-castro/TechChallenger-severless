jest.mock('../../../src/services/db');

const crypto = require('node:crypto');
const db = require('../../../src/services/db');
const {
  createSession,
  rotateSession,
  revokeSession,
  hashToken,
} = require('../../../src/services/refreshTokenService');

const TOKEN = 'a'.repeat(43);
const FAMILY = 'familia-1';

function storedToken(overrides = {}) {
  return {
    id: 'token-1',
    cliente_id: 7,
    familia_id: FAMILY,
    usado_em: null,
    revogado_em: null,
    expirado: false,
    status: 'ATIVO',
    ...overrides,
  };
}

/** Cliente pg falso: responde conforme o SQL e guarda o que foi executado. */
function fakeClient(row) {
  const client = {
    query: jest.fn(async (sql) => {
      if (sql.includes('FOR UPDATE')) return { rows: row ? [row] : [] };
      if (sql.includes('INSERT INTO')) return { rows: [{ refresh_expires_in: 604800 }] };
      return { rows: [], rowCount: 1 };
    }),
    calls: (fragment) => client.query.mock.calls.filter(([sql]) => sql.includes(fragment)),
  };
  db.withTransaction.mockImplementation((fn) => fn(client));
  return client;
}

const log = { add: jest.fn(), warn: jest.fn() };

async function rejectionOf(promise) {
  return promise.then(
    () => {
      throw new Error('deveria ter sido recusado');
    },
    (err) => err,
  );
}

describe('hashToken', () => {
  it('calcula o SHA-256 em hexadecimal', () => {
    const expected = crypto.createHash('sha256').update(TOKEN).digest('hex');
    expect(hashToken(TOKEN)).toBe(expected);
    expect(hashToken(TOKEN)).toHaveLength(64);
  });
});

describe('createSession', () => {
  beforeEach(() => {
    db.query.mockImplementation(async (sql) =>
      sql.includes('INSERT') ? { rows: [{ refresh_expires_in: 604800 }] } : { rows: [] },
    );
  });

  afterEach(() => {
    delete process.env.REFRESH_EXPIRES_IN_SECONDS;
    delete process.env.SESSION_MAX_SECONDS;
  });

  it('gera token opaco de 32 bytes em Base64URL', async () => {
    const { refreshToken } = await createSession({ clienteId: 7 });

    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(refreshToken, 'base64url')).toHaveLength(32);
  });

  it('grava só o hash, nunca o valor do token', async () => {
    const { refreshToken } = await createSession({ clienteId: 7 });

    const params = db.query.mock.calls[0][1];
    expect(params).toContain(hashToken(refreshToken));
    expect(params).not.toContain(refreshToken);
  });

  it('abre uma família nova a cada login', async () => {
    const first = await createSession({ clienteId: 7 });
    const second = await createSession({ clienteId: 7 });

    expect(first.familyId).not.toBe(second.familyId);
    expect(first.refreshToken).not.toBe(second.refreshToken);
  });

  it('usa 7 e 30 dias por padrão', async () => {
    await createSession({ clienteId: 7 });

    expect(db.query.mock.calls[0][1].slice(5)).toEqual([604800, 2592000]);
  });

  it('respeita as variáveis de ambiente', async () => {
    process.env.REFRESH_EXPIRES_IN_SECONDS = '60';
    process.env.SESSION_MAX_SECONDS = '120';

    await createSession({ clienteId: 7 });

    expect(db.query.mock.calls[0][1].slice(5)).toEqual([60, 120]);
  });

  it('apaga as sessões vencidas do mesmo cliente', async () => {
    await createSession({ clienteId: 7 });

    const [sql, params] = db.query.mock.calls[1];
    expect(sql).toContain('DELETE FROM refresh_token');
    expect(params).toEqual([7, null]);
  });

  it('abre sessão de usuário, sem cliente', async () => {
    await createSession({ usuarioId: 3 });

    expect(db.query.mock.calls[0][1].slice(1, 3)).toEqual([null, 3]);
    expect(db.query.mock.calls[1][1]).toEqual([null, 3]);
  });
});

describe('rotateSession', () => {
  it('troca o token, liga ao novo e mantém a família', async () => {
    const client = fakeClient(storedToken());

    const session = await rotateSession(TOKEN, log);

    expect(session).toEqual({
      principal: { id: 7, role: 'cliente' },
      refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      refreshExpiresIn: 604800,
    });
    expect(session.refreshToken).not.toBe(TOKEN);

    const [[, insertParams]] = client.calls('INSERT INTO');
    const [[updateSql, updateParams]] = client.calls('substituido_por = $1');
    const newId = insertParams[0];
    expect(insertParams[1]).toBe(hashToken(session.refreshToken));
    expect(insertParams[3]).toBe('token-1');
    expect(updateSql).toContain('usado_em = now()');
    expect(updateSql).toContain('revogado_em = now()');
    expect(updateParams).toEqual([newId, 'token-1']);
  });

  it('renova usuário sem checar status de cliente, com o tipo do banco', async () => {
    fakeClient(storedToken({ cliente_id: null, usuario_id: 3, status: null, tipo: 'Adm' }));

    const session = await rotateSession(TOKEN, log);

    expect(session.principal).toEqual({ id: 3, role: 'Adm' });
  });

  it('procura pelo hash e trava a linha', async () => {
    const client = fakeClient(storedToken());

    await rotateSession(TOKEN, log);

    const [[sql, params]] = client.calls('FOR UPDATE');
    expect(sql).toContain('FOR UPDATE OF t');
    expect(params).toEqual([hashToken(TOKEN)]);
  });

  it('recusa token malformado sem consultar o banco', async () => {
    const err = await rejectionOf(rotateSession('curto', log));

    expect(err).toMatchObject({ statusCode: 401, reason: 'TOKEN_MALFORMADO' });
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  it('recusa token desconhecido', async () => {
    fakeClient(undefined);

    const err = await rejectionOf(rotateSession(TOKEN, log));

    expect(err).toMatchObject({ statusCode: 401, reason: 'TOKEN_DESCONHECIDO' });
  });

  it('recusa token expirado sem trocar', async () => {
    const client = fakeClient(storedToken({ expirado: true }));

    const err = await rejectionOf(rotateSession(TOKEN, log));

    expect(err).toMatchObject({ statusCode: 401, reason: 'TOKEN_EXPIRADO' });
    expect(client.calls('INSERT INTO')).toHaveLength(0);
  });

  it('recusa token revogado sem nova revogação', async () => {
    const client = fakeClient(storedToken({ revogado_em: new Date() }));

    const err = await rejectionOf(rotateSession(TOKEN, log));

    expect(err).toMatchObject({ statusCode: 401, reason: 'TOKEN_REVOGADO' });
    expect(client.calls('familia_id = $1')).toHaveLength(0);
  });

  it('no reuso, revoga toda a família e não emite token', async () => {
    const client = fakeClient(storedToken({ usado_em: new Date(), revogado_em: new Date() }));

    const err = await rejectionOf(rotateSession(TOKEN, log));

    expect(err).toMatchObject({ statusCode: 401, reason: 'TOKEN_REUTILIZADO' });
    expect(client.calls('familia_id = $1')[0][1]).toEqual([FAMILY]);
    expect(client.calls('INSERT INTO')).toHaveLength(0);
  });

  it('confirma a revogação: a recusa só é lançada depois da transação', async () => {
    fakeClient(storedToken({ usado_em: new Date() }));
    let transactionFinished = false;
    const original = db.withTransaction.getMockImplementation();
    db.withTransaction.mockImplementation(async (fn) => {
      const result = await original(fn);
      transactionFinished = true;
      return result;
    });

    await rejectionOf(rotateSession(TOKEN, log));

    expect(transactionFinished).toBe(true);
  });

  it.each(['INATIVO', 'BLOQUEADO'])(
    'cliente %s: revoga a família e responde 403',
    async (status) => {
      const client = fakeClient(storedToken({ status }));

      const err = await rejectionOf(rotateSession(TOKEN, log));

      expect(err).toMatchObject({ statusCode: 403, code: 'CLIENTE_INATIVO' });
      expect(client.calls('familia_id = $1')[0][1]).toEqual([FAMILY]);
      expect(client.calls('INSERT INTO')).toHaveLength(0);
    },
  );

  it('propaga erro do banco', async () => {
    db.withTransaction.mockRejectedValue(new Error('banco fora'));

    await expect(rotateSession(TOKEN, log)).rejects.toThrow('banco fora');
  });
});

describe('revokeSession', () => {
  it('revoga a família pelo hash do token', async () => {
    db.query.mockResolvedValue({ rowCount: 2 });

    await revokeSession(TOKEN);

    expect(db.query.mock.calls[0][1]).toEqual([hashToken(TOKEN)]);
  });

  it('ignora token malformado', async () => {
    await revokeSession('curto');

    expect(db.query).not.toHaveBeenCalled();
  });
});
