# TechChallenger-severless

Autenticação de clientes da oficina mecânica por **CPF**: uma função **AWS Lambda (Node.js)** exposta via **Amazon API Gateway**.

> **Status:** estrutura inicial. A função e o Terraform ainda serão implementados.

## Repositórios do projeto

| Repositório | Responsabilidade |
|---|---|
| [TechChallenger-infra-kubernetes](https://github.com/arthur-lucas-castro/TechChallenger-infra-kubernetes) | VPC, EKS, node group, ECR, bucket do state |
| [TechChallenger-infra-database](https://github.com/arthur-lucas-castro/TechChallenger-infra-database) | RDS PostgreSQL |
| **TechChallenger-severless** (este) | Lambda de autenticação por CPF + API Gateway |
| [TechChallenger-Api](https://github.com/arthur-lucas-castro/TechChallenger-Api) | API da oficina (valida o token emitido aqui) |

**Ordem de provisionamento:** 1. infra-kubernetes → 2. infra-database → **3. severless**.

## Fluxo

1. O cliente chama `POST /auth` no API Gateway, enviando o CPF.
2. A Lambda valida o CPF e procura o cliente na tabela `cliente` do RDS.
3. Se o cliente existir, a Lambda devolve um **JWT**, assinado com o mesmo segredo (`Jwt__SecretKey`) que a API principal usa para validar.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `src/` | Handler e regras de autenticação (Node.js) |
| `tests/` | Testes de unidade |
| `infra/` | Terraform da Lambda, API Gateway, log group e permissões |
| `docs/adr/` | Decisões de arquitetura |
| `.github/workflows/` | CI (lint + testes) e deploy (empacotar + `terraform apply`) |

## Decisões e integração

O Terraform da Lambda e do API Gateway fica **neste repositório**, em `infra/`, com o state em `key = lambda-auth/terraform.tfstate` no bucket compartilhado ([ADR-002](docs/adr/ADR-002-localizacao-terraform-lambda-api-gateway.md)).

| Dado | Origem (`terraform_remote_state`) |
|---|---|
| `vpc_id`, `private_subnet_ids` | infra-kubernetes (`infra-kubernetes/terraform.tfstate`) |
| `rds_address`, `db_name`, `rds_client_security_group_id` | infra-database (`infra-database/terraform.tfstate`) |

Restrições do AWS Academy Learner Lab:

- a Lambda precisa usar a role existente `LabRole`, porque não é possível criar IAM roles;
- a Lambda roda nas subnets privadas, com o SG `rds-client`, para alcançar o RDS.
