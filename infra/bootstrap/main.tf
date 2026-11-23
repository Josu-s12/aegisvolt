# =============================================================================
# BOOTSTRAP del backend remoto de Terraform (se ejecuta UNA sola vez)
# =============================================================================
# Crea el bucket S3 donde viven TODOS los terraform.tfstate del proyecto, con:
#   - Versioning ENABLED  -> cada `apply` crea una nueva versión del tfstate,
#                            las anteriores quedan como backup restaurable.
#   - Cifrado SSE (AES256) y bloqueo de acceso público.
#   - Tabla DynamoDB de locks para evitar dos `apply` simultáneos.
# Este módulo usa estado LOCAL porque el bucket todavía no existe (huevo-gallina).
# =============================================================================
terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60, < 7.0"
    }
  }
}

variable "use_floci" {
  description = "true = emulador local Floci (http://localhost:4566); false = AWS real"
  type        = bool
  default     = true
}

variable "floci_endpoint" {
  type    = string
  default = "http://localhost:4566"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "state_bucket_name" {
  type    = string
  default = "aegisvolt-tfstate"
}

provider "aws" {
  region                      = var.region
  access_key                  = var.use_floci ? "test" : null
  secret_key                  = var.use_floci ? "test" : null
  skip_credentials_validation = var.use_floci
  skip_metadata_api_check     = var.use_floci
  skip_requesting_account_id  = var.use_floci
  s3_use_path_style           = var.use_floci

  dynamic "endpoints" {
    for_each = var.use_floci ? [1] : []
    content {
      s3       = var.floci_endpoint
      dynamodb = var.floci_endpoint
      sts      = var.floci_endpoint
      iam      = var.floci_endpoint
    }
  }

  default_tags {
    tags = { Project = "aegisvolt", ManagedBy = "terraform", Component = "tfstate-backend" }
  }
}

resource "aws_s3_bucket" "tfstate" {
  bucket = var.state_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Conserva las versiones antiguas 90 días (backups históricos del estado)
resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  count  = var.use_floci ? 0 : 1
  bucket = aws_s3_bucket.tfstate.id
  rule {
    id     = "retain-noncurrent-tfstate"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

resource "aws_dynamodb_table" "tf_locks" {
  name         = "aegisvolt-tf-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
}

output "state_bucket" {
  value = aws_s3_bucket.tfstate.bucket
}

output "versioning_status" {
  value = aws_s3_bucket_versioning.tfstate.versioning_configuration[0].status
}

output "lock_table" {
  value = aws_dynamodb_table.tf_locks.name
}
