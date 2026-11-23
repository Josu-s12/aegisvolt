output "table_names" {
  value = merge(
    { for k, t in aws_dynamodb_table.service : k => t.name },
    { feature_flags = aws_dynamodb_table.feature_flags.name },
  )
}

output "table_arns" {
  value = concat([for t in aws_dynamodb_table.service : t.arn], [aws_dynamodb_table.feature_flags.arn])
}
