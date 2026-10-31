# TechChallenger-severless

Autenticação de clientes da oficina mecânica por **CPF**: uma função **AWS Lambda (Node.js)** exposta via **Amazon API Gateway**.

> **Status:** Lambda de autenticação em implementação. O Lambda Authorizer ainda não foi implementado.

## Tecnologias e dados para o Terraform

| Item               | Valor                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| Runtime            | `nodejs20.x`                                                                                        |
| Handler            | `index.handler` (bundle na raiz do zip; no código-fonte, `src/index.js`)                            |
| Arquitetura        | `arm64` ou `x86_64` (sem módulos nativos)                                                           |
| Sistema de módulos | CommonJS: o Jest mocka módulos CJS de forma estável, enquanto em ESM o suporte ainda é experimental |
| Banco              | RDS PostgreSQL, driver `pg`                                                                         |
| Token              | `jsonwebtoken` (HS256)                                                                              |
| Testes e qualidade | Jest, ESLint e Prettier                                                                             |

Comandos: `npm test`, `npm run test:coverage`, `npm run lint` e `npm run package`.

## Variáveis de ambiente

| Variável                     | Obrigatória | Padrão           | Descrição                                                                                     |
| ---------------------------- | ----------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `JWT_SECRET_PARAM`           | Sim         | -                | Nome do parâmetro SSM com o segredo do JWT (`/techchallenger/jwt/secret`)                     |
| `DB_PARAM_PREFIX`            | Sim         | -                | Prefixo SSM dos dados do banco (`/techchallenger/db`): `host`, `name`, `username`, `password` |
| `NODE_EXTRA_CA_CERTS`        | Sim         | -                | `/var/runtime/ca-cert.pem`, para o Node confiar no certificado do RDS                         |
| `JWT_ISSUER`                 | Não         | `TechChallenger` | Precisa ser igual a `Jwt__Issuer` na API                                                      |
| `JWT_AUDIENCE`               | Não         | `TechChallenger` | Precisa ser igual a `Jwt__Audience` na API                                                    |
| `JWT_KID`                    | Não         | `v1`             | Versão da chave, enviada no header do token                                                   |
| `JWT_EXPIRES_IN_SECONDS`     | Não         | `900`            | Validade do access token                                                                      |
| `REFRESH_EXPIRES_IN_SECONDS` | Não         | `604800`         | Validade do refresh token                                                                     |
| `SESSION_MAX_SECONDS`        | Não         | `2592000`        | Limite absoluto da sessão                                                                     |
| `DB_PORT`                    | Não         | `5432`           | Porta do RDS                                                                                  |
| `DB_POOL_MAX`                | Não         | `1`              | Conexões por ambiente de execução                                                             |
| `DB_SSL`                     | Não         | `true`           | `false` só para Postgres local sem TLS                                                        |

## Migrations

Os scripts ficam em `db/migrations/`, numerados (`V001`, `V002`) e idempotentes: cada um roda em uma transação, usa `IF NOT EXISTS` e registra a versão em `auth_schema_migration`. A tabela `cliente` precisa existir antes.

Como o RDS está em subnet privada, os scripts rodam de dentro da VPC, em um pod temporário no EKS, cujos nodes já têm acesso ao banco:

```bash
DB_HOST=$(aws ssm get-parameter --name /techchallenger/db/host --query Parameter.Value --output text)
DB_NAME=$(aws ssm get-parameter --name /techchallenger/db/name --query Parameter.Value --output text)
DB_USER=$(aws ssm get-parameter --name /techchallenger/db/username --query Parameter.Value --output text)
PGPASSWORD=$(aws ssm get-parameter --name /techchallenger/db/password --with-decryption --query Parameter.Value --output text)

for f in db/migrations/V*.sql; do
  kubectl run "auth-migration-$RANDOM" -i --rm --restart=Never --image=postgres:16-alpine \
    --env="PGPASSWORD=$PGPASSWORD" --env=PGSSLMODE=require -- \
    psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$f"
done
```

Aplique as migrations **antes** de publicar o código da Lambda. A senha fica na especificação do pod enquanto ele existe, por isso o pod é apagado ao final (`--rm`).

## Repositórios do projeto

| Repositório                                                                                               | Responsabilidade                                                                                 |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [TechChallenger-infra-kubernetes](https://github.com/arthur-lucas-castro/TechChallenger-infra-kubernetes) | VPC, EKS, node group, ECR, bucket do state, **API Gateway e infraestrutura das Lambdas**         |
| [TechChallenger-infra-database](https://github.com/arthur-lucas-castro/TechChallenger-infra-database)     | RDS PostgreSQL                                                                                   |
| **TechChallenger-severless** (este)                                                                       | Código das Lambdas (autenticação por CPF e Lambda Authorizer) e pipeline que publica esse código |
| [TechChallenger-Api](https://github.com/arthur-lucas-castro/TechChallenger-Api)                           | API da oficina (valida o token emitido aqui)                                                     |

**Ordem de provisionamento:** 1. infra-kubernetes → 2. infra-database → **3. deploy do código pelo severless**.

## Fluxo

1. O cliente chama `POST /auth` no API Gateway, enviando o CPF.
2. A Lambda valida o CPF e procura o cliente na tabela `cliente` do RDS.
3. Se o cliente existir e estiver ativo, a Lambda devolve um **access token** (JWT de 15 minutos, assinado com o mesmo segredo `Jwt__SecretKey` que a API principal usa para validar) e um **refresh token**.
4. Quando o access token expira, o cliente chama `POST /auth/refresh` para receber um novo par de tokens, sem informar o CPF de novo. `POST /auth/logout` encerra a sessão.

Detalhes do contrato, dos tokens e o diagrama de sequência estão em [docs/auth-flow.md](docs/auth-flow.md).

## Estrutura

| Pasta                | Conteúdo                                                                           |
| -------------------- | ---------------------------------------------------------------------------------- |
| `src/`               | Handlers de `/auth` e do Lambda Authorizer (Node.js)                               |
| `tests/`             | Testes de unidade                                                                  |
| `docs/`              | [Fluxo de autenticação](docs/auth-flow.md) e decisões de arquitetura (`docs/adr/`) |
| `.github/workflows/` | CI (lint + testes) e deploy (empacotar + `aws lambda update-function-code`)        |

## Decisões e integração

O Terraform do API Gateway e das Lambdas fica no **TechChallenger-infra-kubernetes**, junto com a VPC e o EKS ([ADR-002](docs/adr/ADR-002-localizacao-terraform-lambda-api-gateway.md)). Este repositório não tem Terraform: o pipeline só publica o código nas funções que já existem.

| Dado                                                           | Origem                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `lambda_auth_function_name`, `lambda_authorizer_function_name` | Outputs do infra-kubernetes, usados pelo pipeline de deploy                           |
| Conexão com o banco (`/techchallenger/db/*`)                   | SSM Parameter Store, publicado pelo infra-database e lido pelas Lambdas no cold start |
| Segredo do JWT (`/techchallenger/jwt/secret`)                  | SSM Parameter Store, lido pelas Lambdas no cold start                                 |

Restrições do AWS Academy Learner Lab:

- a Lambda precisa usar a role existente `LabRole`, porque não é possível criar IAM roles;
- a Lambda roda nas subnets privadas, com o SG `rds-client`, para alcançar o RDS.
