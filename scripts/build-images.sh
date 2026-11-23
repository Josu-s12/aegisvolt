#!/usr/bin/env bash
# Construye las 5 imágenes Docker y las carga al clúster kind.
#   ./scripts/build-images.sh v1
set -euo pipefail
TAG="${1:-v1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"   # rutas relativas: funcionan igual en Linux, Mac y Git Bash (Windows)
for s in station-reservation-service billing-wallet-service energy-dispatch-service graphql-gateway; do
  docker build -f "services/$s/Dockerfile" -t "aegisvolt/$s:$TAG" services
done
docker build -t "aegisvolt/frontend:$TAG" frontend
if command -v kind >/dev/null && kind get clusters 2>/dev/null | grep -q '^aegisvolt$'; then
  for i in station-reservation-service billing-wallet-service energy-dispatch-service graphql-gateway frontend; do
    kind load docker-image "aegisvolt/$i:$TAG" --name aegisvolt
  done
fi
echo ">>> imágenes aegisvolt/*:$TAG listas"
