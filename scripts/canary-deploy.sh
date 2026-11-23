#!/usr/bin/env bash
# =============================================================================
# CANARY DEPLOYMENT en Kubernetes con análisis automático y rollback.
#   ./scripts/canary-deploy.sh <env> <tag> [componente...]
# Variables: CANARY_WEIGHT=20  ERROR_RATE_THRESHOLD=5  MAX_CANARY_CW_ERRORS=0
#            ANALYSIS_REQUESTS=50  SIMULATE_CANARY_FAILURE=true (demo de rollback)
#
# Cómo se logra el 20%: el Service selecciona por "app" (no por "track"), así
# que reparte entre pods stable y canary. Durante el análisis: 4 stable + 1 canary.
#
# Condiciones para PROMOVER al 100% (todas):
#   1) El pod canary pasa readiness (/health) -> rollout status OK
#   2) Tasa de fallos de las peticiones de prueba que atendió el canary <= ERROR_RATE_THRESHOLD %
#   3) Logs ERROR del canary en CloudWatch (/aegisvolt/<env>/<svc>, track=canary) <= MAX_CANARY_CW_ERRORS
# Si algo falla -> ROLLBACK automático (canary a 0, stable intacto) y exit 1.
# =============================================================================
set -euo pipefail
ENV="${1:?env}"; TAG="${2:?tag}"; shift 2
COMPONENTS=("${@:-station-reservation-service billing-wallet-service energy-dispatch-service graphql-gateway}")
read -r -a COMPONENTS <<< "${COMPONENTS[*]}"
NS="aegisvolt-$ENV"
CANARY_WEIGHT="${CANARY_WEIGHT:-20}"
STABLE_DURING=$(( 100 / CANARY_WEIGHT - 1 ))
ERROR_RATE_THRESHOLD="${ERROR_RATE_THRESHOLD:-5}"
MAX_CANARY_CW_ERRORS="${MAX_CANARY_CW_ERRORS:-0}"
ANALYSIS_REQUESTS="${ANALYSIS_REQUESTS:-50}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/scripts/env.sh" ] && source "$ROOT/scripts/env.sh"

declare -A PORT=( [station-reservation-service]=4001 [billing-wallet-service]=4002 [energy-dispatch-service]=4003 [graphql-gateway]=4000 )

rollback() {
  local c="$1" orig="$2" why="$3"
  echo "❌ ROLLBACK $c: $why"
  kubectl -n "$NS" scale "deploy/$c-canary" --replicas=0
  kubectl -n "$NS" scale "deploy/$c-stable" --replicas="$orig"
  exit 1
}

for c in "${COMPONENTS[@]}"; do
  port="${PORT[$c]}"
  echo "================ CANARY $c -> $TAG en $NS (${CANARY_WEIGHT}%) ================"
  orig=$(kubectl -n "$NS" get "deploy/$c-stable" -o jsonpath='{.spec.replicas}')
  start_ms=$(( $(date +%s) * 1000 ))

  # 1) Tráfico 80/20: 4 pods stable + 1 pod canary con la nueva imagen
  kubectl -n "$NS" scale "deploy/$c-stable" --replicas="$STABLE_DURING"
  kubectl -n "$NS" rollout status "deploy/$c-stable" --timeout=120s
  kubectl -n "$NS" set image "deploy/$c-canary" "$c=aegisvolt/$c:$TAG"
  if [ "${SIMULATE_CANARY_FAILURE:-false}" = "true" ]; then
    kubectl -n "$NS" set env "deploy/$c-canary" APP_VERSION="$TAG" FAIL_HEALTH=true
  else
    kubectl -n "$NS" set env "deploy/$c-canary" APP_VERSION="$TAG" FAIL_HEALTH-
  fi
  kubectl -n "$NS" scale "deploy/$c-canary" --replicas=1

  # 2) Health check: el canary debe quedar Ready (readinessProbe /health)
  if ! kubectl -n "$NS" rollout status "deploy/$c-canary" --timeout=90s; then
    rollback "$c" "$orig" "el pod canary no pasó el health check /health"
  fi

  # 3) Tráfico de prueba a través del Service (se reparte stable/canary)
  out=$(kubectl -n "$NS" exec deploy/frontend -- sh -c \
    "for i in \$(seq 1 $ANALYSIS_REQUESTS); do wget -qO- -T 3 http://$c:$port/health 2>/dev/null || echo '{\"status\":\"FAIL\"}'; echo; done")
  total=$(echo "$out" | grep -c '{' || true)
  canary_ok=$(echo "$out" | grep '"track":"canary"' | grep -c '"status":"UP"' || true)
  stable_ok=$(echo "$out" | grep '"track":"stable"' | grep -c '"status":"UP"' || true)
  failed=$(echo "$out" | grep -c '"status":"\(FAIL\|DOWN\)"' || true)
  rate=$(( total > 0 ? failed * 100 / total : 100 ))
  echo "   tráfico: total=$total stable=$stable_ok canary=$canary_ok fallos=$failed (${rate}%)  umbral=${ERROR_RATE_THRESHOLD}%"
  [ "$rate" -le "$ERROR_RATE_THRESHOLD" ] || rollback "$c" "$orig" "tasa de error ${rate}% > ${ERROR_RATE_THRESHOLD}%"
  [ "$canary_ok" -gt 0 ] || rollback "$c" "$orig" "el canary no recibió tráfico exitoso"

  # 4) Métrica de error en CloudWatch Logs del canary
  sleep 5
  cw_errors=$(aws logs filter-log-events --log-group-name "/aegisvolt/$ENV/$c" --start-time "$start_ms" \
      --filter-pattern '"canary"' --query 'events[].message' --output text 2>/dev/null \
      | tr '\t' '\n' | grep -c '"level":"ERROR"' || true)
  echo "   CloudWatch /aegisvolt/$ENV/$c -> errores track=canary: $cw_errors (máx $MAX_CANARY_CW_ERRORS)"
  [ "$cw_errors" -le "$MAX_CANARY_CW_ERRORS" ] || rollback "$c" "$orig" "$cw_errors errores del canary en CloudWatch"

  # 5) PROMOCIÓN al 100%: la versión estable pasa a ser la nueva
  echo "✅ Canary saludable -> promoviendo $c:$TAG al 100%"
  kubectl -n "$NS" set image "deploy/$c-stable" "$c=aegisvolt/$c:$TAG"
  kubectl -n "$NS" set env "deploy/$c-stable" APP_VERSION="$TAG"
  kubectl -n "$NS" rollout status "deploy/$c-stable" --timeout=180s
  kubectl -n "$NS" scale "deploy/$c-canary" --replicas=0
  kubectl -n "$NS" scale "deploy/$c-stable" --replicas="$orig"
done
echo "🎉 Despliegue $TAG completado en $ENV"
