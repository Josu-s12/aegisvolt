# =============================================================================
# CloudWatch por ambiente: /aegisvolt/<ws>/<servicio>
# Los microservicios escriben logs JSON con correlation_id (= sagaId), environment,
# service, version y track (stable|canary). Los metric filters convierten esos
# logs en métricas que usa el análisis del Canary y las alarmas.
# =============================================================================
locals {
  namespace = "AegisVolt/${var.environment}"
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = toset(var.services)
  name              = "/${var.project}/${var.environment}/${each.key}"
  retention_in_days = var.log_retention_days
  tags              = merge(var.tags, { Service = each.key })
}

resource "aws_cloudwatch_log_group" "prefect" {
  name              = "/${var.project}/${var.environment}/prefect-observability"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

# Errores por servicio (los usa el análisis Canary y la alarma)
resource "aws_cloudwatch_log_metric_filter" "errors" {
  for_each       = aws_cloudwatch_log_group.service
  name           = "${each.key}-errors"
  log_group_name = each.value.name
  pattern        = "{ $.level = \"ERROR\" }"

  metric_transformation {
    name          = "ErrorCount"
    namespace     = local.namespace
    value = "1"
    # (CloudWatch no permite default_value junto con dimensions)
    dimensions = {
      Service = "$.service"
      Track   = "$.track"
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "saga_compensated" {
  name           = "saga-compensated"
  log_group_name = aws_cloudwatch_log_group.service["graphql-gateway"].name
  pattern        = "{ $.message = \"saga_compensated\" }"
  metric_transformation {
    name          = "SagaCompensated"
    namespace     = local.namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "saga_compensation_failed" {
  name           = "saga-compensation-failed"
  log_group_name = aws_cloudwatch_log_group.service["graphql-gateway"].name
  pattern        = "{ $.message = \"saga_compensation_failed\" }"
  metric_transformation {
    name          = "SagaCompensationFailed"
    namespace     = local.namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "compensation_failed" {
  alarm_name          = "${var.project}-${var.environment}-saga-compensation-failed"
  alarm_description   = "Una SAGA no pudo completar su compensación: requiere revisión (transacción huérfana)"
  namespace           = local.namespace
  metric_name         = "SagaCompensationFailed"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}
