# TechChallenger-severless

Autenticação de clientes da oficina mecânica por **CPF**: uma função **AWS Lambda (Node.js)** exposta via **Amazon API Gateway**.

> **Status:** Lambda de autenticação implementada, ainda sem deploy. O Lambda Authorizer ainda não foi implementado.

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

## Testes

Jest, e não `node:test`, porque ele traz limite de cobertura que reprova o comando e mock de módulos estável, necessários para isolar `pg` e o SSM. No Node 20, o mock de módulos do `node:test` ainda é experimental.

`npm test` roda a suíte. `npm run test:coverage` também mede a cobertura e **falha se qualquer métrica ficar abaixo de 80%**. Por isso, é esse o comando que o CI deve usar. Os CPFs dos testes são fictícios, gerados por algoritmo em `tests/helpers/cpf.js`.

## Empacotamento

| Critério        | Zip                                                                   | Container image                             |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------- |
| Tamanho         | 58,5 KB, muito abaixo do limite de 50 MB                              | Dezenas de MB, com a imagem base            |
| Cold start      | Menor                                                                 | Maior no primeiro uso da imagem             |
| Infraestrutura  | `aws lambda update-function-code`, como prevê o ADR-002               | Repositório ECR e novo fluxo de build       |
| Quando compensa | Dependências pequenas e sem binários, o caso de `pg` e `jsonwebtoken` | Binários nativos ou pacotes acima de 250 MB |

**Recomendação: zip.**

`npm run package` instala as dependências de produção com `npm ci --omit=dev` em uma pasta isolada, `dist/build`, para não apagar as ferramentas de desenvolvimento. Depois gera um bundle minificado com esbuild e grava `dist/lambda-auth.zip`, que contém só `index.js`. O bundle reduz 906 KB de código e `node_modules` para 173 KB, o que diminui o que a Lambda precisa carregar no cold start. Testes, docs e `.git` ficam fora por construção. O `@aws-sdk/client-ssm` não vai no bundle, porque já existe no runtime `nodejs20.x`; por isso ele é dependência de desenvolvimento.

**Arquitetura.** Não importa para o pacote: `pg`, `jsonwebtoken` e `bcryptjs` são JavaScript puro, sem `pg-native` nem o `bcrypt` nativo, e o mesmo zip funciona em `x86_64` e `arm64`. O esbuild é binário, mas só roda na máquina de build. O `arm64` costuma ser mais barato por tempo de execução; use-o se o lab permitir, ou `x86_64`, que é o padrão.

**Teste local antes de publicar.** Extraia o zip e chame o handler com um evento de exemplo. O `NODE_PATH` supre o SDK que, na AWS, vem do runtime:

```bash
npm run package
rm -rf /tmp/pacote && unzip dist/lambda-auth.zip -d /tmp/pacote
NODE_PATH="$PWD/node_modules" node -e "
  const event = { ...require('./events/sample-auth.json'), body: '{\"cpf\":\"123\"}' };
  require('/tmp/pacote/index.js').handler(event, {}).then(console.log);
"
```

A resposta esperada é `400 CPF_INVALIDO`, que prova que o bundle carrega e o handler responde sem AWS. Com um evento válido e sem as variáveis de ambiente, o esperado é `500 ERRO_INTERNO`. Para o fluxo completo, publique na Lambda e invoque com `aws lambda invoke --payload fileb://events/sample-auth.json`, usando um CPF fictício cadastrado.

**Memória.** Configure 512 MB. O CPU da Lambda cresce com a memória, e o bcrypt do `POST /auth/login` (custo 12, em JavaScript puro) leva cerca de 340 ms em um computador comum, mas pode levar alguns segundos com 256 MB. Use timeout de 10 s.

## Logs

Cada requisição gera uma linha JSON no stdout, com `requestId` (`requestContext.requestId` do API Gateway, o mesmo dos access logs e do `x-correlation-id` enviado à API), `awsRequestId`, `route`, `status` e `durationMs`. Também podem aparecer `reason` (motivo real de uma recusa), `clienteId`, `familiaId` e `cpf` mascarado (`***.456.789-**`).

O logger oculta campos com nomes sensíveis (`token`, `password` etc.) e remove valores com formato de CPF, JWT ou refresh token de qualquer texto, inclusive de mensagens de erro de bibliotecas.

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
4. `Adm` e `Funcionario` fazem o mesmo em `POST /auth/login`, com e-mail e senha da tabela `usuario`.
5. Quando o access token expira, o cliente chama `POST /auth/refresh` para receber um novo par de tokens, sem informar as credenciais de novo. `POST /auth/logout` encerra a sessão.

Detalhes do contrato, dos tokens e o diagrama de sequência estão em [docs/auth-flow.md](docs/auth-flow.md).

## Estrutura

| Pasta                | Conteúdo                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `src/`               | Roteador (`index.js`), `handlers/` (`auth`, `login`, `refresh`, `logout`), `services/` e `utils/` |
| `db/migrations/`     | Scripts SQL versionados e idempotentes                                                            |
| `events/`            | Eventos de exemplo do API Gateway (payload 2.0)                                                   |
| `scripts/`           | Empacotamento                                                                                     |
| `tests/`             | Testes de unidade                                                                                 |
| `docs/`              | [Fluxo de autenticação](docs/auth-flow.md) e decisões de arquitetura (`docs/adr/`)                |
| `.github/workflows/` | CI (lint + testes) e deploy (empacotar + `aws lambda update-function-code`)                       |

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
