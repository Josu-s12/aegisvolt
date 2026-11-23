#!/usr/bin/env bash
# Wrapper de Terraform por ambiente (mismo comando que usa el pipeline).
#   ./scripts/tf.sh dev plan     ./scripts/tf.sh test apply     ./scripts/tf.sh prod output
set -euo pipefail
ENV="${1:?ambiente: dev|test|prod}"; CMD="${2:-plan}"; shift 2 || true
case "$ENV" in dev|test|prod) ;; *) echo "Ambiente inválido: $ENV"; exit 1;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/env.sh"
cd "$ROOT/infra/envs"
BACKEND="${TF_BACKEND_CONFIG:-backend-floci.hcl}"
terraform init -input=false -reconfigure -backend-config="$BACKEND" >/dev/null
# 1 workspace = 1 ambiente = 1 tfstate aislado en S3 (env:/<ws>/...)
terraform workspace select -or-create "$ENV"
echo ">>> workspace activo: $(terraform workspace show)"
case "$CMD" in
  plan)    terraform plan -input=false -var-file="$ENV.tfvars" -out="tfplan-$ENV" "$@" ;;
  apply)   terraform apply -input=false -auto-approve -var-file="$ENV.tfvars" "$@" ;;
  destroy) terraform destroy -input=false -var-file="$ENV.tfvars" "$@" ;;
  *)       terraform "$CMD" "$@" ;;
esac
