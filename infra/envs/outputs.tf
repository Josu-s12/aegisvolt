output "environment" {
  description = "Workspace / ambiente aplicado"
  value       = terraform.workspace
}

output "vpc_id" {
  value = module.network.vpc_id
}

output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "vpc_endpoints" {
  description = "VPC Endpoints (Gateway: s3, dynamodb | Interface: execute-api, logs, monitoring, eks, ecr, sts)"
  value       = module.network.vpc_endpoint_ids
}

output "dynamodb_tables" {
  value = module.dynamodb.table_names
}

output "log_groups" {
  value = module.observability.log_group_names
}

output "api_gateway_id" {
  value = module.api_gateway.rest_api_id
}

output "api_gateway_invoke_url" {
  description = "URL para invocar GraphQL a través de API Gateway (en Floci vía _user_request_)"
  value       = var.use_floci ? "${var.floci_endpoint}/restapis/${module.api_gateway.rest_api_id}/${terraform.workspace}/_user_request_/graphql" : "${module.api_gateway.invoke_url}/graphql"
}

output "eks_cluster_name" {
  value = try(module.eks[0].cluster_name, null)
}
