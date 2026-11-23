#!/usr/bin/env bash
# =============================================================================
# Levanta TODO el proyecto en tu PC (una sola vez, ~10-15 min la primera vez):
#   1) clúster kind   2) Floci   3) backend S3 versionado   4) terraform apply dev/test/prod
#   5) imágenes Docker   6) despliegue en los 3 namespaces
# =============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/env.sh

echo "== 1/6 Clúster Kubernetes (kind) =="
kind get clusters 2>/dev/null | grep -q '^aegisvolt$' || kind create cluster --config scripts/kind-config.yaml
kubectl config use-context kind-aegisvolt

echo "== 2/6 Floci (AWS local) en la red 'kind' =="
docker compose up -d
for i in $(seq 1 60); do curl -sf http://localhost:4566/_floci/info >/dev/null 2>&1 && break; sleep 2; done
curl -sf http://localhost:4566/_floci/info >/dev/null || { echo "Floci no responde en :4566"; exit 1; }

echo "== 3/6 Backend remoto de Terraform (S3 versionado) =="
./scripts/bootstrap-backend.sh

echo "== 4/6 Infraestructura por workspace =="
for env in dev test prod; do ./scripts/tf.sh "$env" apply; done

echo "== 5/6 Imágenes Docker =="
./scripts/build-images.sh v1

echo "== 6/6 Despliegue en Kubernetes =="
for env in dev test prod; do kubectl apply -k "k8s/overlays/$env"; done
for env in dev test prod; do kubectl -n "aegisvolt-$env" rollout status deploy --timeout=180s; done

cat <<MSG

✅ AegisVolt arriba
   Frontend dev  -> http://localhost:8081     GraphQL dev  -> http://localhost:8401/graphql
   Frontend test -> http://localhost:8082     GraphQL test -> http://localhost:8402/graphql
   Frontend prod -> http://localhost:8083     GraphQL prod -> http://localhost:8403/graphql
MSG
