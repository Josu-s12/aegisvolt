#!/usr/bin/env bash
# Cambia una Feature Flag directamente en la tabla DynamoDB del ambiente, SIN redesplegar.
#   ./scripts/toggle-flag.sh dev SIMULATE_CHARGER_HARDWARE_FAULT true
set -euo pipefail
ENV="${1:?env}"; FLAG="${2:?flag}"; VALUE="${3:?true|false}"
source "$(dirname "$0")/env.sh"
TABLE="aegisvolt-feature-flags-$ENV"
aws dynamodb update-item --table-name "$TABLE" --key "{\"flagName\":{\"S\":\"$FLAG\"}}" \
  --update-expression "SET enabled = :v, updatedAt = :t, updatedBy = :u" \
  --expression-attribute-values "{\":v\":{\"BOOL\":$VALUE},\":t\":{\"S\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"},\":u\":{\"S\":\"cli\"}}"
echo ">>> Flags en $TABLE:"
aws dynamodb scan --table-name "$TABLE" --query 'Items[].[flagName.S, enabled.BOOL]' --output table
