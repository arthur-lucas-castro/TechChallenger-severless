-- V001: status de autenticação do cliente.
-- Idempotente: pode rodar mais de uma vez. Execução: ver "Migrations" no README.md.
BEGIN;

CREATE TABLE IF NOT EXISTS auth_schema_migration (
    versao       varchar(20) PRIMARY KEY,
    aplicada_em  timestamptz NOT NULL DEFAULT now()
);

-- O DEFAULT mantém compatíveis os INSERTs da API, que não conhece esta coluna.
ALTER TABLE cliente
    ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'ATIVO';

-- Postgres não tem "ADD CONSTRAINT IF NOT EXISTS".
DO $$ BEGIN
    ALTER TABLE cliente
        ADD CONSTRAINT ck_cliente_status CHECK (status IN ('ATIVO', 'INATIVO', 'BLOQUEADO'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Cada POST /auth busca por documento, e a coluna ainda não tem índice.
CREATE INDEX IF NOT EXISTS ix_cliente_numerodocumento ON cliente (numerodocumento);

INSERT INTO auth_schema_migration (versao) VALUES ('V001') ON CONFLICT DO NOTHING;

COMMIT;
