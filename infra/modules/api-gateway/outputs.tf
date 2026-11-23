output "rest_api_id" { value = aws_api_gateway_rest_api.this.id }
output "invoke_url" { value = aws_api_gateway_stage.this.invoke_url }
output "vpc_link_id" { value = aws_api_gateway_vpc_link.this.id }
output "nlb_arn" { value = aws_lb.internal.arn }
output "target_group_arn" { value = aws_lb_target_group.graphql.arn }
