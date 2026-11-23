#!/usr/bin/env bash
# Levanta los 3 microservicios + gateway como procesos Node (CI y modo rápido local).
# Uso: APP_ENV=dev AWS_ENDPOINT_URL=http://localhost:4566 ./scripts/start-stack.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .logs
export APP_ENV="${APP_ENV:-dev}" AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}" AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
PORT=4001 nohup node station-reservation-service/src/index.js > .logs/reservation.log 2>&1 &
PORT=4002 nohup node billing-wallet-service/src/index.js      > .logs/billing.log 2>&1 &
PORT=4003 nohup node energy-dispatch-service/src/index.js     > .logs/dispatch.log 2>&1 &
PORT=4000 nohup node graphql-gateway/src/index.js             > .logs/gateway.log 2>&1 &
for p in 4001 4002 4003 4000; do
  for i in $(seq 1 30); do curl -sf "http://localhost:$p/health" >/dev/null && break; sleep 1; done
  curl -sf "http://localhost:$p/health" >/dev/null || { echo "puerto $p no levantó"; tail -50 .logs/*.log; exit 1; }
done
echo "Stack AegisVolt ($APP_ENV) arriba: GraphQL en http://localhost:4000/graphql"
