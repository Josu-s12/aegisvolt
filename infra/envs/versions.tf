terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60, < 7.0"
    }
  }

  # Backend remoto S3 (configuración parcial). Los valores se pasan en `terraform init`:
  #   terraform init -backend-config=backend-floci.hcl   (local con Floci)
  #   terraform init -backend-config=backend-aws.hcl     (AWS real)
  #
  # Con WORKSPACES, el backend S3 guarda cada ambiente en una llave distinta:
  #   s3://aegisvolt-tfstate/env:/dev/aegisvolt/terraform.tfstate
  #   s3://aegisvolt-tfstate/env:/test/aegisvolt/terraform.tfstate
  #   s3://aegisvolt-tfstate/env:/prod/aegisvolt/terraform.tfstate
  # => un apply en el workspace "test" NUNCA lee ni escribe el estado de "prod".
  backend "s3" {}
}
