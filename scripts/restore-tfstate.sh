#!/usr/bin/env bash
# Restaura una versión ANTERIOR del tfstate (ej. tras un cambio corrupto).
#   ./scripts/restore-tfstate.sh dev <VersionId>
# Procedimiento: 1) descargar la versión  2) validarla  3) copiarla encima como
# NUEVA versión (no se borra nada: la versión corrupta queda en el historial).
set -euo pipefail
ENV="${1:?env}"; VERSION="${2:?VersionId (ver tfstate-versions.sh)}"
source "$(dirname "$0")/env.sh"
KEY="env:/$ENV/aegisvolt/terraform.tfstate"
aws s3api get-object --bucket aegisvolt-tfstate --key "$KEY" --version-id "$VERSION" "tfstate-$ENV-$VERSION.json" >/dev/null
"$PY" -c "import json;d=json.load(open('tfstate-$ENV-$VERSION.json'));print('serial',d['serial'],'recursos',len(d['resources']))"
aws s3api copy-object --bucket aegisvolt-tfstate --key "$KEY" --copy-source "aegisvolt-tfstate/$KEY?versionId=$VERSION" >/dev/null
echo ">>> Versión $VERSION restaurada como la más reciente. Verifica con:"
echo "    ./scripts/tf.sh $ENV plan     (Terraform recalcula contra el estado restaurado)"
echo "    Si el lock quedó tomado: terraform force-unlock <LOCK_ID>"
