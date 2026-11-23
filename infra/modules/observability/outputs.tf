output "log_group_names" {
  value = concat([for g in aws_cloudwatch_log_group.service : g.name], [aws_cloudwatch_log_group.api_gateway.name, aws_cloudwatch_log_group.prefect.name])
}
output "metrics_namespace" { value = local.namespace }
