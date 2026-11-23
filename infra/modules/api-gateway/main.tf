# =============================================================================
# API Gateway REST PRIVADO -> VPC Link -> NLB interno -> gateway GraphQL (EKS)
# =============================================================================
# - endpoint_configuration PRIVATE: la API solo es invocable a través del
#   Interface VPC Endpoint "execute-api" de la VPC del ambiente.
# - La resource policy DENIEGA cualquier llamada cuyo aws:SourceVpce no sea el
#   VPCE de este ambiente (dev no puede invocar la API de prod y viceversa).
# - La integración HTTP_PROXY usa connection_type = VPC_LINK hacia un NLB interno
#   en subredes privadas; el NLB entrega a los pods del gateway GraphQL.
# =============================================================================
locals {
  private_api = var.execute_api_vpce_id != null
  backend_uri = var.use_floci ? var.graphql_backend_url : "http://${aws_lb.internal.dns_name}"
}

resource "aws_lb" "internal" {
  name               = "${var.name_prefix}-gql-nlb"
  internal           = true
  load_balancer_type = "network"
  subnets            = var.private_subnet_ids
  tags               = var.tags
}

# Destino: pods del gateway GraphQL (los registra el AWS Load Balancer Controller
# con un TargetGroupBinding en EKS). target_type = ip -> tráfico directo al pod.
resource "aws_lb_target_group" "graphql" {
  name        = "${var.name_prefix}-gql-tg"
  port        = 4000
  protocol    = "TCP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    protocol = "HTTP"
    path     = "/health"
    port     = "traffic-port"
  }
  tags = var.tags
}

resource "aws_lb_listener" "graphql" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 80
  protocol          = "TCP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.graphql.arn
  }
}

resource "aws_api_gateway_vpc_link" "this" {
  name        = "${var.name_prefix}-vpc-link"
  description = "VPC Link privado hacia el NLB interno del clúster (${var.environment})"
  target_arns = [aws_lb.internal.arn]
  tags        = var.tags
}

resource "aws_api_gateway_rest_api" "this" {
  name        = "${var.name_prefix}-api"
  description = "AegisVolt GraphQL API - ambiente ${var.environment}"

  endpoint_configuration {
    types            = [local.private_api ? "PRIVATE" : "REGIONAL"]
    vpc_endpoint_ids = local.private_api ? [var.execute_api_vpce_id] : null
  }
  tags = var.tags
}

data "aws_iam_policy_document" "only_from_vpce" {
  count = local.private_api ? 1 : 0

  statement {
    sid       = "AllowFromThisEnvironmentVpce"
    effect    = "Allow"
    actions   = ["execute-api:Invoke"]
    resources = ["${aws_api_gateway_rest_api.this.execution_arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }

  statement {
    sid       = "DenyOutsideVpce"
    effect    = "Deny"
    actions   = ["execute-api:Invoke"]
    resources = ["${aws_api_gateway_rest_api.this.execution_arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEquals"
      variable = "aws:SourceVpce"
      values   = [var.execute_api_vpce_id]
    }
  }
}

resource "aws_api_gateway_rest_api_policy" "this" {
  count       = local.private_api ? 1 : 0
  rest_api_id = aws_api_gateway_rest_api.this.id
  policy      = data.aws_iam_policy_document.only_from_vpce[0].json
}

resource "aws_api_gateway_resource" "proxy" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "proxy" {
  rest_api_id        = aws_api_gateway_rest_api.this.id
  resource_id        = aws_api_gateway_resource.proxy.id
  http_method        = "ANY"
  authorization      = "NONE"
  request_parameters = { "method.request.path.proxy" = true }
}

resource "aws_api_gateway_integration" "proxy" {
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.proxy.id
  http_method             = aws_api_gateway_method.proxy.http_method
  type                    = "HTTP_PROXY"
  integration_http_method = "ANY"
  uri                     = "${local.backend_uri}/{proxy}"
  connection_type         = "VPC_LINK"
  connection_id           = aws_api_gateway_vpc_link.this.id
  request_parameters      = { "integration.request.path.proxy" = "method.request.path.proxy" }
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  triggers = {
    redeploy = sha1(jsonencode([
      aws_api_gateway_resource.proxy.id,
      aws_api_gateway_method.proxy.id,
      aws_api_gateway_integration.proxy.id,
      aws_api_gateway_integration.proxy.uri,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [aws_api_gateway_integration.proxy, aws_api_gateway_rest_api_policy.this]
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = var.environment
  variables     = { environment = var.environment }
  tags          = var.tags
}
