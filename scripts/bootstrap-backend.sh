#!/usr/bin/env bash
# Crea el bucket S3 versionado + tabla de locks (una sola vez).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/env.sh"
cd "$ROOT/infra/bootstrap"
terraform init -input=false >/dev/null
terraform apply -input=false -auto-approve
echo ">>> Versionamiento del bucket:"
aws s3api get-bucket-versioning --bucket aegisvolt-tfstate
