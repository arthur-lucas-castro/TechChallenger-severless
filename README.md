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
