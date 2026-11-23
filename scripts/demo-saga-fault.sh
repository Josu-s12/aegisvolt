#!/usr/bin/env bash
# DEMO de la rúbrica 6.3: activar la flag de fallo, disparar la mutación GraphQL
# y mostrar en DynamoDB la compensación en billing y reservations.
#   ./scripts/demo-saga-fault.sh test
set -euo pipefail
ENV="${1:-test}"
source "$(dirname "$0")/env.sh"
declare -A GQL=( [dev]=8401 [test]=8402 [prod]=8403 )
URL="${GRAPHQL_URL:-http://localhost:${GQL[$ENV]}/graphql}"
CONNECTOR="${CONNECTOR:-BOG-80-B}"

echo "== 1) Activo SIMULATE_CHARGER_HARDWARE_FAULT en $ENV =="
"$(dirname "$0")/toggle-flag.sh" "$ENV" SIMULATE_CHARGER_HARDWARE_FAULT true >/dev/null
sleep 3

echo "== 2) Saldo ANTES =="
aws dynamodb get-item --table-name "aegisvolt-billing-$ENV" --key '{"pk":{"S":"WALLET#FLEET-ANDES"},"sk":{"S":"PROFILE"}}' --query 'Item.balance.N' --output text

echo "== 3) Mutación GraphQL reserveAndStartCharging =="
RESP=$(curl -s "$URL" -H 'content-type: application/json' -d "{\"query\":\"mutation{ reserveAndStartCharging(input:{fleetId:\\\"FLEET-ANDES\\\", connectorId:\\\"$CONNECTOR\\\", estimatedKwh:15}){ sagaId status failureReason steps{name status} } }\"}")
echo "$RESP" | "$PY" -m json.tool
SAGA=$(echo "$RESP" | "$PY" -c 'import sys,json;print(json.load(sys.stdin)["data"]["reserveAndStartCharging"]["sagaId"])')

echo "== 4) billing-wallet-service: cobro REFUNDED + evento de reversión =="
aws dynamodb query --table-name "aegisvolt-billing-$ENV" --key-condition-expression 'pk = :p' \
  --expression-attribute-values "{\":p\":{\"S\":\"SAGA#$SAGA\"}}" \
  --query 'Items[].{sk:sk.S,status:status.S,type:type.S,amount:amount.N,reason:reason.S}' --output table
echo "   Saldo DESPUÉS (igual al de antes):"
aws dynamodb get-item --table-name "aegisvolt-billing-$ENV" --key '{"pk":{"S":"WALLET#FLEET-ANDES"},"sk":{"S":"PROFILE"}}' --query 'Item.balance.N' --output text

echo "== 5) station-reservation-service: reserva RELEASED y conector AVAILABLE =="
aws dynamodb get-item --table-name "aegisvolt-reservations-$ENV" --key "{\"pk\":{\"S\":\"SAGA#$SAGA\"},\"sk\":{\"S\":\"RESERVATION\"}}" --query 'Item.{status:status.S,reason:releaseReason.S}' --output table
aws dynamodb get-item --table-name "aegisvolt-reservations-$ENV" --key "{\"pk\":{\"S\":\"CONNECTOR#$CONNECTOR\"},\"sk\":{\"S\":\"STATE\"}}" --query 'Item.{connector:connectorId.S,status:status.S}' --output table

echo "== 6) energy-dispatch-service: sesión FAILED =="
aws dynamodb get-item --table-name "aegisvolt-dispatch-$ENV" --key "{\"pk\":{\"S\":\"SAGA#$SAGA\"},\"sk\":{\"S\":\"SESSION\"}}" --query 'Item.{status:status.S,error:error.S}' --output table

echo "== 7) Apago la flag =="
"$(dirname "$0")/toggle-flag.sh" "$ENV" SIMULATE_CHARGER_HARDWARE_FAULT false >/dev/null
echo "correlation_id para rastrear en CloudWatch: $SAGA"
echo "   ./scripts/trace-correlation.sh $ENV $SAGA"
