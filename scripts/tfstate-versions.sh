#!/usr/bin/env bash
# Lista las versiones del tfstate de un workspace en el bucket S3 versionado.
#   ./scripts/tfstate-versions.sh dev
set -euo pipefail
ENV="${1:?env}"
source "$(dirname "$0")/env.sh"
KEY="env:/$ENV/aegisvolt/terraform.tfstate"
echo ">>> s3://aegisvolt-tfstate/$KEY"
aws s3api list-object-versions --bucket aegisvolt-tfstate --prefix "$KEY" \
  --query 'Versions[].{VersionId:VersionId,Ultima:IsLatest,Fecha:LastModified,Bytes:Size}' --output table
