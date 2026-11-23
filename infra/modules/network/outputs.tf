output "vpc_id" { value = aws_vpc.this.id }
output "public_subnet_ids" { value = aws_subnet.public[*].id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "private_route_table_id" { value = aws_route_table.private.id }
output "eks_cluster_sg_id" { value = aws_security_group.eks_cluster.id }
output "vpce_sg_id" { value = aws_security_group.vpce.id }

output "execute_api_vpce_id" {
  value = try(aws_vpc_endpoint.interface["execute-api"].id, null)
}

output "vpc_endpoint_ids" {
  value = merge(
    { for k, v in { s3 = one(aws_vpc_endpoint.s3[*].id), dynamodb = one(aws_vpc_endpoint.dynamodb[*].id) } : k => v if v != null },
    { for k, v in aws_vpc_endpoint.interface : k => v.id },
  )
}
