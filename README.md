# ⚡ AegisVolt

Plataforma cloud-native de gestión de carga para flotas eléctricas y electrolineras (Proyecto Final · Patrones Arquitectónicos Avanzados).

```
Cliente (React) ──HTTPS──► API Gateway PRIVADO ──VPCE execute-api──► VPC Link ─► NLB interno
                                                                                   │
                         ┌──────────────── Kubernetes (EKS / kind) ────────────────▼──────┐
                         │  graphql-gateway (GraphQL + Orquestador SAGA)                  │
                         │     ├── station-reservation-service ──► aegisvolt-reservations-<env>
                         │     ├── billing-wallet-service      ──► aegisvolt-billing-<env>
                         │     └── energy-dispatch-service     ──► aegisvolt-dispatch-<env>
                         └────────────────────────────────────────────────────────────────┘
   DynamoDB (Gateway VPCE) · CloudWatch Logs /aegisvolt/<env>/<svc> (Interface VPCE) · Prefect
```

| Carpeta | Contenido |
|---|---|
| `infra/bootstrap` | Bucket S3 **versionado** para los `terraform.tfstate` + tabla de locks |
| `infra/envs` | Módulo raíz: un solo código, el ambiente lo decide `terraform.workspace` (dev/test/prod) |
| `infra/modules/*` | `network` (VPC, subredes, rutas, VPCE), `dynamodb`, `observability` (CloudWatch), `api-gateway` (privado + VPC Link + NLB), `eks` |
| `services/` | 3 microservicios + `graphql-gateway` (esquema GraphQL + orquestador SAGA) + tests unit/integration/e2e |
| `frontend/` | React (Vite) servido por nginx; consume el GraphQL de su propio ambiente |
| `k8s/` | Kustomize: `base` (Deployments stable/canary + Services) y `overlays/dev|test|prod` |
| `prefect/` | Flujo de observabilidad (salud, auditoría SAGA, CloudWatch) |
| `.github/workflows` | `ci.yml` (PR: guard de promoción, lint/build, unit, integration, e2e, terraform plan) y `cd.yml` (merge: apply por workspace + canary) |
| `scripts/` | Arranque local, canary, demos de la sustentación |
| `docs/GUIA.md` | **Guía paso a paso + guion de sustentación por rúbrica** |

Arranque rápido (Git Bash / Linux / Mac, con Docker, kind, kubectl, Terraform y AWS CLI instalados):

```bash
./scripts/local-up.sh
# Frontend: http://localhost:8081 (dev) · 8082 (test) · 8083 (prod)
```

Lee **docs/GUIA.md** para todo el detalle.
