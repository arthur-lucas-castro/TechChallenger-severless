-- V003: sessões de refresh token também para Adm e Funcionario (tabela usuario).
-- Idempotente: pode rodar mais de uma vez. Execução: ver "Migrations" no README.md.
BEGIN;

ALTER TABLE refresh_token
    ADD COLUMN IF NOT EXISTS usuario_id integer REFERENCES usuario (id) ON DELETE CASCADE;

ALTER TABLE refresh_token ALTER COLUMN cliente_id DROP NOT NULL;

-- Toda sessão pertence a exatamente um dono. Postgres não tem "ADD CONSTRAINT IF NOT EXISTS".
DO $$ BEGIN
    ALTER TABLE refresh_token
        ADD CONSTRAINT ck_refresh_token_dono CHECK (num_nonnulls(cliente_id, usuario_id) = 1);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS ix_refresh_token_usuario ON refresh_token (usuario_id);

INSERT INTO auth_schema_migration (versao) VALUES ('V003') ON CONFLICT DO NOTHING;

COMMIT;
