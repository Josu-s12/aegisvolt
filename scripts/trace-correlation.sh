#!/usr/bin/env bash
# Rastrea un correlation_id (sagaId) en TODOS los grupos de logs del ambiente.
#   ./scripts/trace-correlation.sh test saga-1234...
set -euo pipefail
ENV="${1:?env}"; CID="${2:?correlation_id}"
source "$(dirname "$0")/env.sh"
for svc in graphql-gateway station-reservation-service billing-wallet-service energy-dispatch-service; do
  echo "---------- /aegisvolt/$ENV/$svc ----------"
  aws logs filter-log-events --log-group-name "/aegisvolt/$ENV/$svc" --filter-pattern "\"$CID\"" \
    --query 'events[].message' --output text | tr '\t' '\n' | "$PY" "$(dirname "$0")/format-logs.py"
done
