# ADR-002 — Localização do Terraform da Lambda de autenticação e do API Gateway

- **Status:** Aceito
- **Data:** 2026-10-22
- **Repositórios afetados:** `lambda-auth`, `infra-kubernetes`, `infra-database`
- **Nomes reais dos repositórios:** `lambda-auth` = TechChallenger-severless · `app-principal` = TechChallenger-Api · `infra-kubernetes` = TechChallenger-infra-kubernetes · `infra-database` = TechChallenger-infra-database

## Contexto

A autenticação de clientes por CPF passa a ser uma função serverless em Node.js (AWS Lambda), exposta por um API Gateway. A função:

- recebe o CPF em uma rota HTTP (ex.: `POST /auth`);
- valida o CPF e procura o cliente na tabela `cliente` do PostgreSQL (RDS);
- devolve um token (JWT) que a API principal, no EKS, aceita.

Para chegar ao RDS, que fica em subnets privadas, a Lambda precisa rodar **dentro da VPC**, que é criada pelo `infra-kubernetes`, e ter acesso liberado no security group do banco, que é criado pelo `infra-database`.

O [fluxo de autenticação](../auth-flow.md) definiu que o mesmo API Gateway (HTTP API) também é a **porta de entrada da API no EKS**. As rotas protegidas passam por um Lambda Authorizer e chegam ao cluster por um VPC Link. Com isso, o gateway deixa de pertencer só à autenticação e vira um recurso de borda compartilhado.

Restrição do ambiente: no AWS Academy Learner Lab não é possível criar IAM roles. As Lambdas precisam usar a `LabRole` existente, como o EKS já faz.

É preciso decidir onde fica o Terraform das Lambdas, do API Gateway e dos recursos ligados a eles (permissões, log groups, security groups, VPC Link).

## Alternativas consideradas

### Opção A — Terraform dentro de `lambda-auth/infra/`

**Prós**
- Código e infraestrutura da função mudam juntos. Runtime, memória, timeout, variáveis de ambiente e rotas do gateway são alterados no mesmo PR do código que precisa deles.
- O pipeline é único e linear: `test → empacotar .zip → terraform apply`.
- Não há drift entre o deploy de código e o state do Terraform, porque só o Terraform publica a função.
- O repositório é autocontido.

**Contras**
- O pipeline do `lambda-auth` precisa de credenciais que criam infraestrutura, e não só publicam código.
- Com o gateway servindo também a API do EKS, ele passa a ter rotas, VPC Link e integração com o cluster. Esses recursos não pertencem ao `lambda-auth`. Seria preciso dividir o gateway entre dois repositórios ou deixar o repositório da função gerenciando a borda inteira.

### Opção B — Terraform no `infra-kubernetes`

**Prós**
- O gateway, o VPC Link e a integração com o EKS ficam no repositório que já é dono da VPC, das subnets e do cluster. A borda fica inteira em um só lugar.
- Os recursos de rede (subnets e security groups da Lambda) ficam no mesmo state da VPC, sem precisar de `terraform_remote_state` para eles.
- As permissões ficam separadas: o pipeline do `lambda-auth` só publica código (`lambda:UpdateFunctionCode`) e não altera infraestrutura.
- Não cria um 5º repositório.

**Contras**
- O deploy de código e o state do Terraform passam a ter donos diferentes. É preciso usar `ignore_changes` em `filename`/`source_code_hash` e publicar o código com `aws lambda update-function-code`.
- Uma variável de ambiente ou rota nova exige dois PRs coordenados: um no `infra-kubernetes` e outro no `lambda-auth`.
- O `infra-kubernetes` deixa de ser só sobre o EKS e passa a ser o repositório de "plataforma e borda".
- O primeiro `apply` precisa de um pacote da função antes que o código real exista. Isso se resolve com um pacote placeholder (ver Consequências).
- Cria uma dependência circular com o `infra-database`, que precisa ser quebrada (ver Consequências).

## Decisão

**O Terraform do API Gateway e de toda a infraestrutura das Lambdas fica no `infra-kubernetes`.** Os recursos ficam no state desse repositório (`infra-kubernetes/terraform.tfstate`).

Recursos gerenciados pelo `infra-kubernetes`:

| Recurso | Observação |
|---|---|
| `aws_lambda_function` da autenticação (`/auth`) | Role `LabRole`, `vpc_config` nas subnets privadas com o SG `rds-client`, pacote placeholder e `ignore_changes` no código |
| `aws_lambda_function` do Lambda Authorizer | Role `LabRole`, fora da VPC, pacote placeholder e `ignore_changes` no código |
| `aws_cloudwatch_log_group` das duas funções | |
| `aws_security_group` `rds-client` | Sem regras próprias. Passa a ser criado aqui, e não no `infra-database` |
| `aws_apigatewayv2_api` (HTTP API), stage, integrações e rotas | `POST /auth`, `POST /auth/refresh` e `POST /auth/logout` sem authorizer; demais rotas com o authorizer |
| `aws_apigatewayv2_authorizer` | Tipo `REQUEST`, resposta simples, TTL de 300 s |
| `aws_apigatewayv2_vpc_link` e integração com o ALB/NLB interno do EKS | |
| `aws_lambda_permission` para o API Gateway invocar as duas funções | |

O repositório `lambda-auth` mantém o **código** das duas funções (handler de `/auth` e do Authorizer), os testes e o pipeline de CI/CD, que **só publica código** nas funções já existentes.

Outputs do `infra-kubernetes` usados pelos outros repositórios:

| Output | Consumidor |
|---|---|
| `rds_client_security_group_id` | `infra-database`, para liberar a porta 5432 a partir desse SG |
| `lambda_auth_function_name`, `lambda_authorizer_function_name` | Pipeline do `lambda-auth` |
| `api_gateway_endpoint` | Documentação e testes de ponta a ponta |

## Consequências

- **Dependência circular com o `infra-database`.** A Lambda precisa do endpoint do RDS e de um SG liberado no banco, e o RDS precisa da VPC criada pelo `infra-kubernetes`. Para quebrar o ciclo, o `infra-kubernetes` **nunca lê o state do `infra-database`**:
  1. O SG `rds-client` é criado pelo `infra-kubernetes`, que é dono da VPC. O `infra-database` o lê via `terraform_remote_state` e libera o ingress na porta 5432 a partir dele.
  2. O `infra-database` publica os dados de conexão no **SSM Parameter Store** (`/techchallenger/db/host`, `/techchallenger/db/name`, `/techchallenger/db/username` e `/techchallenger/db/password` como `SecureString`). A Lambda recebe apenas o prefixo (`DB_PARAM_PREFIX=/techchallenger/db`) e lê os valores no cold start, do mesmo jeito que lê o segredo do JWT (`JWT_SECRET_PARAM`).
- **Ordem de provisionamento:** `infra-kubernetes` → `infra-database` → deploy do código pelo `lambda-auth`.
- **Primeiro apply.** O `infra-kubernetes` gera um pacote placeholder com `data "archive_file"`: um handler que responde `503`. Assim as funções existem antes do primeiro deploy de código. O pipeline do `lambda-auth` substitui o placeholder com `aws lambda update-function-code`.
- **Drift controlado.** As funções usam `lifecycle { ignore_changes = [filename, source_code_hash] }`. O Terraform cuida de runtime, memória, timeout, variáveis de ambiente e rede. O código é responsabilidade exclusiva do pipeline do `lambda-auth`.
- **Mudanças coordenadas.** Uma variável de ambiente ou rota nova precisa ser criada primeiro no `infra-kubernetes` e só depois usada pelo código no `lambda-auth`.
- **Mudanças no `infra-database`** em relação ao `rds.tf` atual:
  1. trocar a referência direta `aws_eks_cluster.this...cluster_security_group_id` por `data.terraform_remote_state.kubernetes.outputs.eks_cluster_security_group_id`;
  2. ler `rds_client_security_group_id` do `infra-kubernetes` e liberar o ingress a partir dele, em vez de criar esse SG;
  3. publicar os parâmetros de conexão no SSM.
- **Rede.** A Lambda de `/auth` roda dentro da VPC e lê o SSM em tempo de execução. Isso exige NAT Gateway ou VPC endpoint `ssm` na VPC do `infra-kubernetes`.
- **Segredo do JWT.** O segredo precisa ser o mesmo na Lambda (que emite o token), no Authorizer e no `app-principal` (que valida). Ele fica em um único lugar, o parâmetro `/techchallenger/jwt/secret` no SSM Parameter Store ([auth-flow, seção 4](../auth-flow.md#4-onde-guardar-a-chave-de-assinatura-aws-academy--labrole)), e nunca no código.
