-- V002: sessões de refresh token. Guarda só o SHA-256 do token, nunca o valor.
-- Idempotente: pode rodar mais de uma vez. Execução: ver "Migrations" no README.md.
BEGIN;

CREATE TABLE IF NOT EXISTS refresh_token (
    id                uuid        PRIMARY KEY,
    cliente_id        integer     NOT NULL REFERENCES cliente (id) ON DELETE CASCADE,
    familia_id        uuid        NOT NULL,                  -- uma família = uma sessão de login
    token_hash        char(64)    NOT NULL UNIQUE,           -- SHA-256 em hexadecimal
    expira_em         timestamptz NOT NULL,                  -- validade deste token
    sessao_expira_em  timestamptz NOT NULL,                  -- limite absoluto da sessão
    criado_em         timestamptz NOT NULL DEFAULT now(),
    usado_em          timestamptz,                           -- preenchido quando o token é trocado
    revogado_em       timestamptz,                           -- troca, logout, inativação ou reuso
    substituido_por   uuid        REFERENCES refresh_token (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_refresh_token_familia ON refresh_token (familia_id);
CREATE INDEX IF NOT EXISTS ix_refresh_token_cliente ON refresh_token (cliente_id);

INSERT INTO auth_schema_migration (versao) VALUES ('V002') ON CONFLICT DO NOTHING;

COMMIT;
