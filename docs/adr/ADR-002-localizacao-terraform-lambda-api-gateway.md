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

Restrição do ambiente: no AWS Academy Learner Lab não é possível criar IAM roles. A Lambda precisa usar a `LabRole` existente, como o EKS já faz.

É preciso decidir onde fica o Terraform da Lambda, do API Gateway e dos recursos ligados a eles (permissões, log group, security group da função).

## Alternativas consideradas

### Opção A — Terraform dentro de `lambda-auth/infra/`

**Prós**
- Código e infraestrutura da função mudam juntos. Runtime, handler, memória, timeout, variáveis de ambiente e rotas do gateway são alterados no mesmo PR do código que precisa deles.
- O pipeline é único e linear: `test → empacotar .zip → terraform apply`. O `source_code_hash` do `aws_lambda_function` detecta código novo e atualiza a função sem passo extra.
- Não há drift entre um deploy de código (`aws lambda update-function-code`) e o state do Terraform, porque só o Terraform publica a função.
- O repositório é autocontido: dá para entender, testar e implantar a autenticação lendo um único repositório.
- Segue a divisão em 4 repositórios exigida, sem criar um quinto.

**Contras**
- O pipeline do `lambda-auth` precisa de credenciais que criam infraestrutura, e não só publicam código. No Learner Lab as credenciais são as mesmas de qualquer forma.
- Todo deploy de código roda `terraform plan/apply`. O plan é pequeno, então isso é aceitável.
- Se o API Gateway passar a ser o ponto de entrada também da API do EKS, ele vira um recurso compartilhado e deixa de pertencer só ao `lambda-auth`.

### Opção B — Terraform em um repositório de infraestrutura separado (`infra-serverless`, ou dentro de `infra-kubernetes`)

**Prós**
- As permissões ficam separadas: quem publica código não altera infraestrutura.
- Facilita um API Gateway compartilhado entre a Lambda e a API do EKS.

**Contras**
- O deploy de código precisa de outro mecanismo (`aws lambda update-function-code` ou artefato no S3). Isso cria drift com o state do Terraform e obriga a usar `ignore_changes` em `filename`/`source_code_hash`.
- Uma rota ou variável de ambiente nova exige dois PRs coordenados em dois repositórios.
- Ou se cria um 5º repositório, fora do escopo pedido, ou se coloca serverless dentro do `infra-kubernetes`, cujo propósito é o EKS. Isso quebra a coesão daquele repositório.
- A ordem de deploy fica mais frágil: a infraestrutura precisa de um pacote da função para o primeiro `apply`, e o pacote vem de outro repositório.

## Decisão

**O Terraform da Lambda e do API Gateway fica em `lambda-auth/infra/`**, com state próprio no mesmo bucket S3 compartilhado (`key = "lambda-auth/terraform.tfstate"`).

Integração com os outros repositórios, **somente leitura** via `terraform_remote_state`:

| Dado | Origem |
|---|---|
| `vpc_id`, `private_subnet_ids` | outputs do `infra-kubernetes` |
| `rds_endpoint`, `db_name`, `rds_client_security_group_id` | outputs do `infra-database` |

Para que o `lambda-auth` não altere recursos de outro repositório, o `infra-database` cria e exporta um **security group "cliente do RDS"**, sem regras próprias. O SG do RDS libera a porta 5432 para esse grupo. A Lambda (e qualquer outro consumidor futuro) apenas associa esse SG às suas ENIs.

Recursos que o `lambda-auth/infra/` gerencia: `aws_lambda_function` (role `LabRole`, `vpc_config`), `aws_cloudwatch_log_group`, `aws_apigatewayv2_api` (HTTP API), integração, rota, stage e `aws_lambda_permission`.

## Consequências

- **Ordem de provisionamento:** `infra-kubernetes` → `infra-database` → `lambda-auth`.
- O `infra-database` precisa de duas mudanças em relação ao `rds.tf` atual:
  1. trocar a referência direta `aws_eks_cluster.this...cluster_security_group_id` por `data.terraform_remote_state.kubernetes.outputs.eks_cluster_security_group_id`;
  2. criar e exportar o SG `rds-client` e liberar o ingress a partir dele.
- O segredo de assinatura do JWT precisa ser o mesmo na Lambda (que emite o token) e no `app-principal` (que valida). Ele deve ficar em um único lugar, como um secret do GitHub replicado nos dois repositórios ou o AWS Secrets Manager, e nunca no código.
- **Gatilho de revisão:** se o API Gateway passar a rotear também as chamadas para a API do EKS (ponto de entrada único), revisar esta decisão. Nesse cenário o gateway deve ir para um repositório de borda/infraestrutura, e a Lambda continua publicando o próprio código e expondo apenas o ARN da função.
