# =============================================================================
# AegisVolt - módulo raíz. UN solo código para dev, test y prod.
# El ambiente lo decide el WORKSPACE activo:  terraform workspace select dev|test|prod
# =============================================================================

locals {
  environment = terraform.workspace
  project     = var.project
  # Prefijo de TODOS los recursos: aegisvolt-dev, aegisvolt-test, aegisvolt-prod
  name_prefix = "${var.project}-${terraform.workspace}"

  common_tags = {
    Project     = var.project
    Environment = terraform.workspace
    ManagedBy   = "terraform"
    Workspace   = terraform.workspace
  }
}

# Guardia: impide aplicar en el workspace "default" o en uno desconocido.
resource "terraform_data" "workspace_guard" {
  input = terraform.workspace

  lifecycle {
    precondition {
      condition     = contains(["dev", "test", "prod"], terraform.workspace)
      error_message = "Workspace inválido '${terraform.workspace}'. Usa: terraform workspace select dev|test|prod"
    }
  }
}

module "network" {
  source = "../modules/network"

  name_prefix          = local.name_prefix
  environment          = local.environment
  region               = var.region
  vpc_cidr             = var.vpc_cidr
  availability_zones   = var.availability_zones
  enable_vpc_endpoints = var.enable_vpc_endpoints
  tags                 = local.common_tags
}

module "dynamodb" {
  source = "../modules/dynamodb"

  project             = var.project
  environment         = local.environment
  pitr_enabled        = var.dynamodb_pitr
  deletion_protection = var.dynamodb_deletion_protection
  seed_file           = "${path.root}/../../seed/seed-data.json"
  tags                = local.common_tags
}

module "observability" {
  source = "../modules/observability"

  project            = var.project
  environment        = local.environment
  log_retention_days = var.log_retention_days
  services           = var.services
  tags               = local.common_tags
}

module "eks" {
  source = "../modules/eks"
  count  = var.enable_eks ? 1 : 0

  name_prefix        = local.name_prefix
  environment        = local.environment
  kubernetes_version = var.kubernetes_version
  private_subnet_ids = module.network.private_subnet_ids
  cluster_sg_id      = module.network.eks_cluster_sg_id
  node_instance_type = var.node_instance_type
  node_count         = var.node_count
  tags               = local.common_tags
}

module "api_gateway" {
  source = "../modules/api-gateway"

  name_prefix         = local.name_prefix
  environment         = local.environment
  vpc_id              = module.network.vpc_id
  private_subnet_ids  = module.network.private_subnet_ids
  execute_api_vpce_id = module.network.execute_api_vpce_id
  graphql_backend_url = var.graphql_backend_url
  use_floci           = var.use_floci
  tags                = local.common_tags
}
