# =============================================================================
# DynamoDB - patrón Database-per-Service, una tabla por servicio y por ambiente
#   aegisvolt-reservations-<ws>  -> station-reservation-service
#   aegisvolt-billing-<ws>       -> billing-wallet-service
#   aegisvolt-dispatch-<ws>      -> energy-dispatch-service
#   aegisvolt-sagas-<ws>         -> orquestador SAGA (capa GraphQL)
#   aegisvolt-feature-flags-<ws> -> Feature Flags del ambiente
# El sufijo <ws> = terraform.workspace hace imposible que test toque prod.
# =============================================================================
locals {
  seed = jsondecode(file(var.seed_file))

  pk_sk_tables = {
    reservations = "station-reservation-service"
    billing      = "billing-wallet-service"
    dispatch     = "energy-dispatch-service"
    sagas        = "graphql-gateway (saga-orchestrator)"
  }
}

resource "aws_dynamodb_table" "service" {
  for_each = local.pk_sk_tables

  name                        = "${var.project}-${each.key}-${var.environment}"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  range_key                   = "sk"
  deletion_protection_enabled = var.deletion_protection

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  dynamic "ttl" {
    for_each = each.key == "dispatch" ? [1] : []
    content {
      attribute_name = "ttl"
      enabled        = true
    }
  }

  point_in_time_recovery {
    enabled = var.pitr_enabled
  }

  tags = merge(var.tags, { Name = "${var.project}-${each.key}-${var.environment}", OwnerService = each.value })
}

resource "aws_dynamodb_table" "feature_flags" {
  name                        = "${var.project}-feature-flags-${var.environment}"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "flagName"
  deletion_protection_enabled = var.deletion_protection

  attribute {
    name = "flagName"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.pitr_enabled
  }

  tags = merge(var.tags, { Name = "${var.project}-feature-flags-${var.environment}", OwnerService = "feature-flags" })
}

# ---------------- Datos semilla (IaC) ----------------
# ignore_changes = [item]: Terraform crea el valor INICIAL de cada flag por
# ambiente, pero NO revierte los cambios hechos en caliente (toggle desde la UI
# o el CLI). Así cambiar una flag no requiere redesplegar ni un nuevo apply.
resource "aws_dynamodb_table_item" "flags" {
  for_each   = local.seed.flags
  table_name = aws_dynamodb_table.feature_flags.name
  hash_key   = aws_dynamodb_table.feature_flags.hash_key

  item = jsonencode({
    flagName    = { S = each.key }
    enabled     = { BOOL = each.value.values[var.environment] }
    description = { S = each.value.description }
    updatedBy   = { S = "terraform" }
  })

  lifecycle {
    ignore_changes = [item]
  }
}

resource "aws_dynamodb_table_item" "connectors" {
  for_each   = { for c in local.seed.connectors : c.connectorId => c }
  table_name = aws_dynamodb_table.service["reservations"].name
  hash_key   = "pk"
  range_key  = "sk"

  item = jsonencode({
    pk            = { S = "CONNECTOR#${each.key}" }
    sk            = { S = "STATE" }
    connectorId   = { S = each.key }
    stationId     = { S = each.value.stationId }
    stationName   = { S = each.value.stationName }
    city          = { S = each.value.city }
    connectorType = { S = each.value.connectorType }
    powerKw       = { N = tostring(each.value.powerKw) }
    ultraFast     = { BOOL = each.value.ultraFast }
    status        = { S = "AVAILABLE" }
  })

  lifecycle {
    ignore_changes = [item] # el estado del conector lo maneja el microservicio
  }
}

resource "aws_dynamodb_table_item" "wallets" {
  for_each   = { for w in local.seed.wallets : w.fleetId => w }
  table_name = aws_dynamodb_table.service["billing"].name
  hash_key   = "pk"
  range_key  = "sk"

  item = jsonencode({
    pk        = { S = "WALLET#${each.key}" }
    sk        = { S = "PROFILE" }
    fleetId   = { S = each.key }
    fleetName = { S = each.value.fleetName }
    balance   = { N = tostring(each.value.balance) }
    currency  = { S = each.value.currency }
  })

  lifecycle {
    ignore_changes = [item]
  }
}
