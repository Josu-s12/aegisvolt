#!/usr/bin/env bash
# Crea un RULESET de GitHub que protege dev, test y prod:
#   - non_fast_forward  -> bloquea git push --force
#   - pull_request      -> prohíbe push directo (todo entra por PR), solo merge commit
#   - required_status_checks -> CI en verde antes de habilitar Merge
#   - deletion          -> no se pueden borrar las ramas
# Sin "bypass_actors": aplica también al dueño/admin del repo.
#   ./scripts/setup-branch-protection.sh tu-usuario/aegisvolt
set -euo pipefail
REPO="${1:?owner/repo}"
gh api -X POST "repos/$REPO/rulesets" --input - <<JSON
{
  "name": "proteccion-ambientes-dev-test-prod",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["refs/heads/dev", "refs/heads/test", "refs/heads/prod"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "promotion-guard" },
          { "context": "lint-build" },
          { "context": "unit-tests" },
          { "context": "integration-tests" },
          { "context": "e2e-tests" },
          { "context": "terraform-plan" }
        ] } }
  ]
}
JSON
echo ">>> Ruleset creado. Verifica en: https://github.com/$REPO/settings/rules"
