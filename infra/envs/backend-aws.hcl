# terraform init -backend-config=backend-aws.hcl   (AWS real, credenciales por AWS_PROFILE / OIDC)
bucket               = "aegisvolt-tfstate-CAMBIAR-SUFIJO-UNICO"
key                  = "aegisvolt/terraform.tfstate"
workspace_key_prefix = "env:"
region               = "us-east-1"
encrypt              = true
dynamodb_table       = "aegisvolt-tf-locks"
