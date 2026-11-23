# Uso: source scripts/env.sh   -> AWS CLI / SDK apuntando a Floci
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
export AWS_REGION=us-east-1
export AWS_PAGER=""
# Python: en Windows (Git Bash) suele llamarse "python"
PY="$(command -v python3 2>/dev/null || command -v python)"
export PY
# Git Bash (Windows) convierte argumentos tipo "/aegisvolt/dev/..." o "env:/dev/..." en rutas
# de Windows y rompe los comandos de AWS. Esto lo desactiva.
export MSYS_NO_PATHCONV=1
