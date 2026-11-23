#!/usr/bin/env bash
# Simula una SAGA HUÉRFANA (el orquestador "murió" después de reservar y cobrar)
# para demostrar que el flujo de Prefect la detecta.
#   ./scripts/inject-orphan-saga.sh dev
set -euo pipefail
ENV="${1:?env}"
source "$(dirname "$0")/env.sh"
ID="saga-orphan-$(date +%s)"
OLD="$("$PY" -c 'import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=10)).isoformat().replace("+00:00","Z"))')"
aws dynamodb put-item --table-name "aegisvolt-sagas-$ENV" --item "{
  \"pk\":{\"S\":\"SAGA#$ID\"},\"sk\":{\"S\":\"META\"},\"sagaId\":{\"S\":\"$ID\"},\"correlationId\":{\"S\":\"$ID\"},
  \"environment\":{\"S\":\"$ENV\"},\"fleetId\":{\"S\":\"FLEET-ANDES\"},\"connectorId\":{\"S\":\"MDE-POB-A\"},
  \"estimatedKwh\":{\"N\":\"10\"},\"priority\":{\"BOOL\":false},\"status\":{\"S\":\"STARTED\"},
  \"steps\":{\"L\":[{\"M\":{\"name\":{\"S\":\"RESERVE_CONNECTOR\"},\"status\":{\"S\":\"SUCCEEDED\"},\"at\":{\"S\":\"$OLD\"}}}]},
  \"createdAt\":{\"S\":\"$OLD\"},\"updatedAt\":{\"S\":\"$OLD\"}}"
echo ">>> SAGA huérfana insertada: $ID (STARTED hace 10 min). Ejecuta el flujo de Prefect para verla detectada."
