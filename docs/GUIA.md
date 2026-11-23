# AegisVolt · Guía paso a paso y guion de sustentación

Esta guía tiene 3 partes:

- **Parte A**: qué instalar en el PC (recién formateado, Windows).
- **Parte B**: montar el proyecto paso a paso (GitHub, infraestructura, despliegue, Prefect).
- **Parte C**: guion de sustentación. Para cada punto de la rúbrica: qué decir, qué mostrar y dónde está en el código. Incluye la respuesta a las 10 preguntas del banco.

> Todos los comandos se ejecutan en **Git Bash** (viene con Git for Windows), dentro de la carpeta del proyecto, salvo que se indique otra cosa.

---

## PARTE A · Qué instalar (Windows 10/11)

Abre **PowerShell como administrador** y ejecuta estos comandos uno por uno (winget ya viene con Windows 11):

| # | Herramienta | Comando de instalación | Para qué sirve |
|---|---|---|---|
| 1 | WSL 2 (requisito de Docker) | `wsl --install` → **reinicia el PC** | Docker Desktop corre sobre WSL2 |
| 2 | Docker Desktop | `winget install -e --id Docker.DockerDesktop` | Contenedores, Floci y el clúster kind |
| 3 | Git (+ Git Bash) | `winget install -e --id Git.Git` | Repositorio y terminal bash |
| 4 | GitHub CLI | `winget install -e --id GitHub.cli` | Crear el repo y las reglas de ramas |
| 5 | Node.js 22 LTS | `winget install -e --id OpenJS.NodeJS.LTS` | Microservicios, gateway y frontend |
| 6 | Python 3.12 | `winget install -e --id Python.Python.3.12` | Prefect |
| 7 | Terraform | `winget install -e --id Hashicorp.Terraform` | Infraestructura como código |
| 8 | AWS CLI v2 | `winget install -e --id Amazon.AWSCLI` | Consultar S3, DynamoDB, CloudWatch (en Floci) |
| 9 | kubectl | `winget install -e --id Kubernetes.kubectl` | Manejar Kubernetes |
| 10 | kind | `winget install -e --id Kubernetes.kind` | Clúster Kubernetes local dentro de Docker |
| 11 | VS Code (opcional) | `winget install -e --id Microsoft.VisualStudioCode` | Editor |

Después de instalar:

1. Abre **Docker Desktop**, acepta los términos y espera a que diga *Engine running*. En *Settings → Resources* deja al menos **6 GB de RAM**.
2. **Cierra y vuelve a abrir** las terminales (para que carguen el PATH nuevo).
3. Abre **Git Bash** y verifica las versiones:

```bash
docker version && git --version && gh --version && node -v && python --version \
 && terraform -version && aws --version && kubectl version --client && kind version
```

Todos deben responder con una versión. Si uno falla con *command not found*, cierra Git Bash, ábrelo otra vez y vuelve a probar. Si sigue fallando, reinicia el PC.

4. Inicia sesión en GitHub: `gh auth login` (elige GitHub.com → HTTPS → Login with a web browser).
5. Configura tu identidad de git:

```bash
git config --global user.name "Tu Nombre"
git config --global user.email "tu-correo@ejemplo.com"
git config --global core.autocrlf input
```

> ¿Tienes Mac? Usa `brew install --cask docker` y `brew install git gh node@22 python@3.12 terraform awscli kubectl kind`. Instala también `bash` nuevo (`brew install bash`): los scripts usan bash 4+.

---

## PARTE B · Montar el proyecto paso a paso

### B0. Plan para hoy (orden recomendado)

| Bloque | Tiempo aprox. | Qué |
|---|---|---|
| 1 | 40 min | Parte A: instalar herramientas |
| 2 | 15 min | B1–B2: subir el repo a GitHub con ramas dev/test/prod y protecciones |
| 3 | 20 min | B3: levantar todo local con `./scripts/local-up.sh` |
| 4 | 10 min | B4: probar la UI y la SAGA |
| 5 | 10 min | B5: Prefect |
| 6 | 30 min | B6: hacer el flujo de promoción completo feature → dev → test → prod (genera la evidencia de CI/CD) |
| 7 | 30 min+ | Parte C: ensayar el guion de sustentación |

### B1. Crear el repositorio en GitHub

Descomprime el zip del proyecto (por ejemplo en `C:\Users\TU_USUARIO\aegisvolt`) y en Git Bash:

```bash
cd ~/aegisvolt
git init -b main
git add .
# Windows no guarda el permiso de ejecución: lo marcamos para que GitHub Actions pueda correr los scripts
git update-index --chmod=+x scripts/*.sh services/scripts/*.sh
git commit -m "AegisVolt: proyecto inicial"
# Repo PÚBLICO: los rulesets de ramas son gratis en repos públicos
gh repo create aegisvolt --public --source=. --remote=origin --push

# Las 3 ramas de ambientes estáticos
git branch dev && git branch test && git branch prod
git push origin dev test prod
gh repo edit --default-branch dev
```

### B2. Proteger las ramas (ruleset)

```bash
./scripts/setup-branch-protection.sh TU_USUARIO_GITHUB/aegisvolt
```

El script crea el ruleset **proteccion-ambientes-dev-test-prod** sobre `dev`, `test` y `prod` con:

- `non_fast_forward` → bloquea `git push --force`.
- `pull_request` → prohíbe el push directo (todo entra por PR, método de merge "merge commit").
- `required_status_checks` → el botón *Merge* solo se habilita con `promotion-guard`, `lint-build`, `unit-tests`, `integration-tests`, `e2e-tests` y `terraform-plan` en verde.
- `deletion` → no se pueden borrar las ramas.
- Sin *bypass actors* → aplica incluso a ti, que eres admin.

Verifícalo en GitHub → *Settings → Rules → Rulesets*.

> Opcional y recomendado: en *Settings → Environments → New environment* crea `prod` con **Required reviewers = tú**. Así el pipeline de CD pide aprobación manual antes de tocar producción.

### B3. Levantar todo en tu PC

Con Docker Desktop encendido:

```bash
./scripts/local-up.sh
```

El script hace 6 pasos (la primera vez tarda 10–15 min porque descarga imágenes):

1. **kind**: crea el clúster Kubernetes `aegisvolt` (publica los puertos 8081–8083 y 8401–8403).
2. **Floci**: arranca el emulador de AWS en `localhost:4566`, conectado a la red docker `kind` (`docker-compose.yml`), con almacenamiento persistente en `.floci-data/`.
3. **Backend de Terraform**: `infra/bootstrap` crea el bucket `aegisvolt-tfstate` con **Versioning Enabled** y la tabla de locks `aegisvolt-tf-locks`.
4. **Infraestructura por workspace**: `./scripts/tf.sh dev apply`, luego `test` y luego `prod`. Cada uno selecciona su workspace y su `.tfvars`.
5. **Imágenes Docker**: construye las 5 imágenes con tag `v1` y las carga a kind.
6. **Kubernetes**: `kubectl apply -k k8s/overlays/<env>` en los namespaces `aegisvolt-dev`, `aegisvolt-test` y `aegisvolt-prod`.

Al final debes ver:

| Ambiente | Frontend | GraphQL |
|---|---|---|
| dev | http://localhost:8081 | http://localhost:8401/graphql |
| test | http://localhost:8082 | http://localhost:8402/graphql |
| prod | http://localhost:8083 | http://localhost:8403/graphql |

Comprobaciones rápidas:

```bash
source scripts/env.sh
terraform -chdir=infra/envs workspace list           # default, dev, test, prod
aws dynamodb list-tables                             # 15 tablas: 5 por ambiente
aws logs describe-log-groups --query 'logGroups[].logGroupName'
kubectl get pods -A | grep aegisvolt
```

**Si algo falla en el paso 4 (Terraform contra Floci):** vuelve a correr solo ese ambiente con más detalle:

```bash
./scripts/tf.sh dev apply
```

Si el error menciona un recurso concreto que el emulador no soporta, desactívalo solo en local y continúa:

- Endpoints de VPC: `./scripts/tf.sh dev apply -var enable_vpc_endpoints=false`
- EKS: `./scripts/tf.sh dev apply -var enable_eks=false`

El código sigue declarándolos, así que puedes explicarlos igual. Lo ideal es que todo aplique completo.

### B4. Probar la aplicación

Abre http://localhost:8082 (test). La pantalla tiene las 4 funcionalidades que pide el enunciado:

- **a. Estado de electrolineras**: conectores en verde (AVAILABLE), amarillo (RESERVED) o azul (CHARGING). Se refresca cada 2 s.
- **b. Reservar y activar carga**: dispara la SAGA. Prueba los 3 casos:
  - *Éxito*: flota Andes, conector BOG-80-A, 20 kWh → **COMPLETED**, el conector queda CHARGING (haz clic en él para ver la telemetría).
  - *Fondos insuficientes*: flota Pacífico (saldo bajo), 200 kWh → **COMPENSATED** (solo libera el conector).
  - *Falla de hardware*: activa `SIMULATE_CHARGER_HARDWARE_FAULT` → reserva → **COMPENSATED** (reembolso + liberación).
- **c. Feature Flags del ambiente**: botones ON/OFF (escriben en la tabla `aegisvolt-feature-flags-<env>`).
- **d. Historial**: cada SAGA con su `correlation_id`, estado y motivo. Haz clic en una fila para ver los pasos y las compensaciones.

### B5. Prefect

En una terminal nueva:

```bash
cd ~/aegisvolt/prefect
python -m venv .venv && source .venv/Scripts/activate     # en Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
prefect server start
```

Deja esa terminal abierta. El dashboard queda en http://127.0.0.1:4200.

En **otra** terminal:

```bash
cd ~/aegisvolt/prefect && source .venv/Scripts/activate
source ../scripts/env.sh
export PREFECT_API_URL=http://127.0.0.1:4200/api
python flows/aegisvolt_observability.py --serve
```

Esto crea un *deployment* que corre cada 2 minutos. Para ejecutarlo ya: dashboard → *Deployments* → **aegisvolt-observability-cada-2-min** → *Run* → *Quick run*.

Para demostrar la detección de transacciones huérfanas:

```bash
./scripts/inject-orphan-saga.sh dev
```

En la siguiente ejecución, el artefacto **aegisvolt-report** la lista como "atascada (huérfana)".

### B6. Flujo de promoción completo (evidencia de CI/CD)

Haz esto **antes** de la sustentación, para tener PRs y pipelines en verde que mostrar.

```bash
git checkout dev && git pull
git checkout -b feature/tarifa-nocturna
# cambio pequeño, por ejemplo en services/billing-wallet-service/src/pricing.js
# cambia el comentario o agrega una línea en README
git commit -am "feat: ajuste de tarifas"
git push -u origin feature/tarifa-nocturna
gh pr create --base dev --head feature/tarifa-nocturna --title "feature: tarifa nocturna" --body "Cambio de prueba"
```

1. En GitHub → *Pull requests*, mira los 6 checks. Cuando estén en verde, haz **Merge** (merge commit).
2. Se dispara **CD (Post-Merge)** sobre `dev`: `terraform apply` en el workspace dev y luego el canary.
3. Promueve dev → test:

```bash
gh pr create --base test --head dev --title "promote: dev -> test" --body "Promoción"
```

4. Cuando esté en verde, haz Merge. Corre el CD sobre `test`.
5. Promueve test → prod:

```bash
gh pr create --base prod --head test --title "promote: test -> prod" --body "Promoción"
```

6. Haz Merge. Si configuraste el environment `prod` con aprobación, apruébalo en la pestaña *Actions*.

**Prueba el guard**: abre un PR de `feature/x` directo hacia `test`. El check `promotion-guard` falla con "A 'test' solo se promueve desde 'dev'" y el botón Merge queda bloqueado.

> **Sobre el runner del CD:** por defecto el CD corre en `ubuntu-latest` y monta dentro del job un entorno efímero (Floci + kind), así que todo queda demostrado en el log de Actions. Si quieres que el CD modifique tu Floci y tu kind locales, registra tu PC como *self-hosted runner* (*Settings → Actions → Runners → New self-hosted runner*) y crea la variable de repositorio `CD_RUNNER=self-hosted`. No es obligatorio.

---

## PARTE C · Guion de sustentación por rúbrica

Formato de cada punto: **Qué decir**, luego **Qué mostrar**, y **Dónde está en el código**.

Antes de entrar, deja abiertos:

- Git Bash en la carpeta del proyecto, con `source scripts/env.sh` ya ejecutado.
- VS Code con el proyecto.
- Navegador con: frontend dev (8081) y prod (8083), GitHub (repo, PRs, Actions, Rulesets) y Prefect (4200).

---

### Capa 1 · Infraestructura como Código (30 %)

#### 1.1 Uso real de Workspaces

**Qué decir:** "Hay un solo código Terraform en `infra/envs`. El ambiente lo decide el workspace activo: todos los nombres usan `terraform.workspace` (`local.name_prefix = aegisvolt-${terraform.workspace}`), y cada workspace tiene su propio tfstate en S3. Además, un `precondition` impide aplicar en el workspace `default`."

**Qué mostrar:**

```bash
cd infra/envs
terraform workspace list
terraform workspace select test && terraform workspace show
terraform state list | head -20
cd ../..
```

**Dónde está:** `infra/envs/main.tf` (locals + `terraform_data.workspace_guard`), `infra/envs/{dev,test,prod}.tfvars`, `scripts/tf.sh`.

#### 1.2 Pregunta: "¿Cómo garantiza que un apply en test no sobrescriba las tablas ni el estado de prod?"

**Respuesta (3 capas de aislamiento):**

1. **Estado:** con workspaces, el backend S3 guarda cada ambiente en otra llave: `env:/test/aegisvolt/terraform.tfstate` frente a `env:/prod/...`. Un apply en test solo lee y escribe su archivo. Prod ni siquiera está en su estado, así que Terraform no puede modificarlo ni destruirlo.
2. **Nombres:** todos los recursos llevan el sufijo del workspace (`aegisvolt-billing-test` frente a `aegisvolt-billing-prod`), así que no hay colisión. Además, cada ambiente tiene su CIDR (10.10 / 10.20 / 10.30).
3. **Pipeline:** el CD solo selecciona el workspace de la rama que recibió el merge. Un merge a `test` nunca ejecuta `workspace select prod`. Prod tiene además `deletion_protection` en DynamoDB y PITR.

Extra: el lock en DynamoDB (`aegisvolt-tf-locks`) impide dos apply simultáneos sobre el mismo estado.

**Qué mostrar:**

```bash
aws s3 ls s3://aegisvolt-tfstate --recursive          # env:/dev/..., env:/test/..., env:/prod/...
aws dynamodb list-tables --query 'TableNames' --output table
```

#### 1.3 Pregunta: "Muestre las versiones anteriores del tfstate de dev y cómo restauraría la versión previa"

**Qué mostrar:**

```bash
aws s3api get-bucket-versioning --bucket aegisvolt-tfstate     # "Status": "Enabled"
./scripts/tfstate-versions.sh dev                               # lista de VersionId con fecha
```

Si solo hay una versión, genera otra antes de la sustentación: cambia algo pequeño, por ejemplo `log_retention_days = 5` en `dev.tfvars`, y corre `./scripts/tf.sh dev apply`.

**Qué decir (procedimiento de restauración):**

1. `./scripts/tfstate-versions.sh dev` para identificar la última versión buena por fecha o serial.
2. `./scripts/restore-tfstate.sh dev <VersionId>`: descarga esa versión, la valida (serial y número de recursos) y la copia encima como versión nueva. Nada se borra: la versión corrupta queda en el historial para auditoría.
3. `./scripts/tf.sh dev plan` para comprobar que Terraform reconcilia contra el estado restaurado. Si quedó un lock colgado: `terraform force-unlock <ID>`.

Comando equivalente a mano:

```bash
aws s3api copy-object --bucket aegisvolt-tfstate \
  --key "env:/dev/aegisvolt/terraform.tfstate" \
  --copy-source "aegisvolt-tfstate/env:/dev/aegisvolt/terraform.tfstate?versionId=<ID>"
```

**Dónde está:** `infra/bootstrap/main.tf` (versioning, cifrado, bloqueo público, lifecycle de versiones antiguas), `infra/envs/versions.tf` y `backend-floci.hcl`.

#### 1.4 Pregunta: "Explique el recorrido de un paquete desde API Gateway hasta el pod a través del VPCE, y qué tabla de enrutamiento o política interviene"

**Qué decir (de memoria, en orden):**

1. El cliente llama a la API REST de API Gateway, que es de tipo **PRIVATE**: solo se puede invocar a través del Interface VPC Endpoint `execute-api` de la VPC del ambiente.
2. Ese **Interface VPCE** crea ENIs con IP privada en las subredes privadas. Con `private_dns_enabled`, el DNS de `execute-api` resuelve a esas IPs privadas. El **security group `vpce-sg`** solo permite 443 desde el CIDR de la VPC.
3. API Gateway evalúa la **resource policy**: *Deny* si `aws:SourceVpce` no es el VPCE de este ambiente. Por eso dev no puede invocar la API de prod.
4. La integración `HTTP_PROXY` tiene `connection_type = VPC_LINK`. El **VPC Link** entrega el tráfico a un **NLB interno** ubicado en las subredes privadas.
5. El NLB reenvía al **target group** (tipo `ip`, puerto 4000, health check `/health`), es decir, a los pods del `graphql-gateway` en EKS. El SG `eks-sg` solo admite tráfico desde el CIDR de la VPC.
6. El gateway llama a los microservicios por Services ClusterIP (red interna del clúster).
7. Los microservicios van a DynamoDB por el **Gateway VPCE de DynamoDB**: en la **tabla de rutas privada** hay una ruta con el *prefix list* de DynamoDB que apunta al VPCE. Los logs van a CloudWatch por el **Interface VPCE `logs`**.
8. La tabla de rutas privada **no tiene ruta 0.0.0.0/0** (ni IGW ni NAT): el tráfico interno nunca sale a internet.

**Qué mostrar:**

```bash
aws ec2 describe-vpc-endpoints --query 'VpcEndpoints[].[VpcEndpointType,ServiceName,VpcId]' --output table
aws ec2 describe-route-tables --filters Name=tag:Name,Values=aegisvolt-dev-rt-private --output json
aws apigateway get-rest-apis --query 'items[].[name,endpointConfiguration.types[0],id]' --output table
aws apigateway get-vpc-links --output table
```

Para llamar a GraphQL a través de API Gateway (Floci):

```bash
URL=$(terraform -chdir=infra/envs output -raw api_gateway_invoke_url)   # con el workspace dev seleccionado
curl -s "$URL" -H 'content-type: application/json' -d '{"query":"{ environment { name } }"}'
```

**Dónde está:** `infra/modules/network/main.tf` (comentario de cabecera con el recorrido), `infra/modules/api-gateway/main.tf`.

#### 1.5 Aprovisionamiento de DynamoDB

**Qué decir:** "Patrón *Database-per-Service*: cada microservicio tiene su propia tabla y nadie lee la tabla de otro. Las tablas se crean con Terraform por ambiente (`aegisvolt-reservations-dev`, `aegisvolt-billing-test`, `aegisvolt-dispatch-prod`…), en modo PAY_PER_REQUEST, con PITR y protección contra borrado en prod. Los datos semilla también son IaC, con `ignore_changes` para que Terraform no revierta los cambios hechos en caliente, como el toggle de una flag."

**Dónde está:** `infra/modules/dynamodb/main.tf`, `seed/seed-data.json`.

---

### Capa 2 · CI/CD, Git, ambientes y Canary (25 %)

#### 2.1 Pregunta: "Intente un push --force o un push directo a test y muestre qué regla lo bloquea"

**Qué mostrar:**

```bash
git checkout test && git pull
git commit --allow-empty -m "push directo prohibido"
git push origin test             # rechazado: "Changes must be made through a pull request"
git push --force origin test     # rechazado: "Cannot force-push to this branch"
git reset --hard origin/test     # deja tu rama local limpia
```

Después abre GitHub → *Settings → Rules → Rulesets → proteccion-ambientes-dev-test-prod* y señala las reglas *Block force pushes*, *Require a pull request before merging* y *Require status checks to pass*.

**Qué decir:** "El ruleset no tiene *bypass*, así que bloquea incluso al administrador. GitHub devuelve el error GH013 *Repository rule violations*."

#### 2.2 Flujo de promoción feature → dev → test → prod

**Qué decir:** "Las ramas de funcionalidad salen de `dev` y solo entran a `dev`. Después se promueve con un PR `dev→test` y otro `test→prod`. El job `promotion-guard` del CI lo hace cumplir: si el origen no corresponde al destino, falla, y como es un check obligatorio, el Merge queda bloqueado. Usamos merge commit (no squash) para que las ramas compartan historia y no haya conflictos cruzados ni cherry-picks."

**Qué mostrar:** la lista de PRs cerrados (`gh pr list --state merged`) y el `promotion-guard` fallando en un PR inválido.

**Dónde está:** `.github/workflows/ci.yml`, job `promotion-guard`.

#### 2.3 Tests y terraform plan en el PR

**Qué decir:** "En cada PR corren 6 checks: `lint-build` (sintaxis, esquema GraphQL, build del frontend, build de las 5 imágenes Docker y validación de los manifiestos de Kubernetes), `unit-tests` (pricing y la SAGA con compensaciones, reintentos e idempotencia usando dobles de prueba), `integration-tests` (contra tablas DynamoDB reales en Floci y contra el endpoint GraphQL), `e2e-tests` (flujo completo vía GraphQL más el frontend) y `terraform-plan`, que selecciona el workspace de la **rama destino** (`github.base_ref`), ejecuta el plan y lo adjunta como artefacto y resumen."

**Qué mostrar:** un PR → pestaña *Checks*. En la ejecución de `terraform-plan`: el *Summary* con "Plan: X to add" y el artefacto `tfplan-<env>`.

#### 2.4 Pregunta: "Explique en el YAML cómo se determina dinámicamente el ambiente para terraform apply tras el merge"

**Qué mostrar:** `.github/workflows/cd.yml`, job `detect-environment`.

**Qué decir:** "El workflow se dispara con `on: push` a `dev`, `test` o `prod`. Un merge de PR es un push a la rama destino. El job lee `GITHUB_REF_NAME` (la rama que recibió el merge), la valida con un `case` y la publica como output `environment`. El job `deploy` la recibe como `ENVIRONMENT` y ejecuta:"

```bash
terraform workspace select -or-create "${ENVIRONMENT}"
terraform apply -auto-approve -var-file="${ENVIRONMENT}.tfvars"
```

"Así solo se toca el ambiente de esa rama. Además, `environment: ${{ ... }}` usa los GitHub Environments, de modo que prod puede exigir aprobación manual."

#### 2.5 Pregunta: "¿Qué métrica o condición evalúa el Canary antes de pasar del 20 % al 100 %?"

**Qué decir:** "El canary va en `scripts/canary-deploy.sh`. Cada microservicio tiene dos Deployments, `-stable` y `-canary`, detrás del **mismo Service**, que selecciona solo por `app`. Durante el análisis hay 4 pods stable y 1 canary, o sea 20 % del tráfico a la nueva versión. Se promueve al 100 % solo si se cumplen las tres condiciones:"

1. El pod canary pasa la **readinessProbe `/health`** (`kubectl rollout status`).
2. La **tasa de error** de 50 peticiones de prueba enviadas por el Service es ≤ 5 % (`ERROR_RATE_THRESHOLD`). En la salida se ve el reparto real, por ejemplo `stable=41 canary=9`.
3. **CloudWatch**: 0 logs `ERROR` con `track=canary` en `/aegisvolt/<env>/<servicio>` desde el inicio del canary (`MAX_CANARY_CW_ERRORS`). Además, el metric filter `ErrorCount` (dimensiones Service y Track) convierte esos logs en métrica.

"Si alguna condición falla: **rollback automático**, el canary vuelve a 0 réplicas, el stable queda intacto y el pipeline termina en rojo."

**Qué mostrar (en vivo, local):**

```bash
./scripts/build-images.sh v2
./scripts/canary-deploy.sh dev v2 billing-wallet-service                                  # promoción OK
./scripts/build-images.sh v3
SIMULATE_CANARY_FAILURE=true ./scripts/canary-deploy.sh dev v3 billing-wallet-service     # ROLLBACK
kubectl -n aegisvolt-dev get deploy -L track
```

---

### Capa 3 · Backend, Microservicios, Kubernetes, GraphQL, SAGA y Flags (25 %)

#### 3.1 Diseño del esquema GraphQL

**Qué decir:** "Un esquema unificado en la capa de agregación. **Queries**: `stations`, `connectors`, `telemetry`, `featureFlags`, `wallets`, `quote`, `transactions` y `health`. **Mutations**: `reserveAndStartCharging` (dispara la SAGA: reserva, pago y sesión de carga), `stopCharging`, `setFeatureFlag` y `topUpWallet`. El cliente nunca habla directo con los microservicios."

**Dónde está:** `services/graphql-gateway/src/schema.graphql`.

#### 3.2 Desacople de microservicios (Docker / Kubernetes)

**Qué decir:** "Son 3 servicios independientes con su propio Dockerfile, puerto, Deployment, Service y tabla. Se comunican solo por HTTP a través del orquestador, nunca por base de datos compartida. Es la misma imagen en los 3 ambientes; cambia solo la configuración (ConfigMap del overlay: `APP_ENV`, URLs). Cada uno tiene readiness/liveness probes, límites de recursos y RollingUpdate."

```bash
kubectl get deploy,svc -n aegisvolt-test
```

#### 3.3 Pregunta: "Active la flag de fallo en test, dispare la mutación y demuestre en DynamoDB la compensación"

**Qué mostrar (un solo comando hace todo):**

```bash
./scripts/demo-saga-fault.sh test
```

Hace y muestra, en orden:

1. Activa `SIMULATE_CHARGER_HARDWARE_FAULT` en `aegisvolt-feature-flags-test`.
2. Muestra el saldo ANTES.
3. Ejecuta la mutación `reserveAndStartCharging` → `status: COMPENSATED`, pasos `RESERVE ✓ → CHARGE ✓ → ACTIVATE ✗ → REFUND_WALLET → RELEASE_CONNECTOR`.
4. **billing**: `SAGA#…/CHARGE` en `REFUNDED` más el evento `EVENT#REFUND` de tipo `REVERSAL`; el saldo DESPUÉS es igual al de antes.
5. **reservations**: la reserva queda `RELEASED` y el conector `AVAILABLE`.
6. **dispatch**: la sesión queda `FAILED` con el error físico.
7. Apaga la flag y te da el `correlation_id` para CloudWatch.

También se puede hacer desde la UI de test (8082): botón de la flag a ON, reservar y ver la fila COMPENSATED.

**Qué decir:** "Es una SAGA por **orquestación**: el orquestador vive en la capa GraphQL (`saga-orchestrator.js`) y guarda su log en `aegisvolt-sagas-<env>`. Si falla el paso 3, compensa en **orden inverso**: primero el reembolso en billing y después la liberación en reservations. Si falla el paso 2 (fondos insuficientes), solo libera el conector."

#### 3.4 Pregunta: "¿Cómo evita problemas de idempotencia si una compensación se procesa dos veces?"

**Respuesta:**

1. El `sagaId` viaja a todos los servicios y es la **clave de idempotencia**: los registros se guardan con `pk = SAGA#<sagaId>`.
2. Cada operación es una **transacción condicional de DynamoDB** (`TransactWriteItems` + `ConditionExpression`):
   - El cobro crea el registro con `attribute_not_exists(pk)`. Un reintento no vuelve a cobrar, devuelve el mismo cobro (`idempotentReplay`).
   - El **reembolso** solo se ejecuta si `status = CHARGED`, y en la misma transacción atómica: lo pasa a REFUNDED, devuelve el saldo y crea `EVENT#REFUND` con `attribute_not_exists`. Si llega duplicado, la condición falla, no se toca el saldo y se responde `alreadyCompensated: true`.
   - La **liberación** exige `status IN (RESERVED, CHARGING)` y que el conector tenga `sagaId = :saga`, así no libera un conector que ya tomó otra SAGA.
3. Como las compensaciones son idempotentes, el orquestador las **reintenta con backoff exponencial** (3 intentos) sin riesgo. Si se agotan, la SAGA queda `COMPENSATION_FAILED`, salta una alarma de CloudWatch y Prefect la reporta.
4. A nivel de API, `requestId` en la mutación genera el mismo `sagaId`, así que reenviar la petición devuelve la misma SAGA.

Esto está probado en `test/integration/dynamodb-repositories.test.js` ("procesar la compensación dos veces devuelve el dinero UNA vez") y en el e2e de idempotencia.

#### 3.5 Aislamiento de Feature Flags por ambiente

**Qué decir:** "Sistema propio sobre DynamoDB: **una tabla por ambiente** (`aegisvolt-feature-flags-dev/test/prod`). El valor inicial lo pone Terraform desde `seed-data.json` (surge y boost en true para dev y test, false para prod). Cada servicio solo conoce la tabla de su `APP_ENV`, así que es físicamente imposible que un cambio en dev afecte a prod. Las flags se leen en cada petición con caché de 2 s: no hay que redesplegar."

---

### Capa 4 · Observabilidad (12 %) y Capa 5 · Frontend (8 %)

#### 4.1 Pregunta: "Muestre en Prefect la ejecución del flujo y rastree en CloudWatch el correlation_id de una SAGA fallida"

**Qué mostrar:**

1. Prefect (http://127.0.0.1:4200) → *Runs* → última ejecución de **aegisvolt-observability**: tareas `check_service_health`, `check_dynamodb_tables`, `audit_saga_consistency`, `check_cloudwatch_errors` y `publish_metrics` en verde. Luego, en *Artifacts*: la tabla `aegisvolt-health` y el reporte `aegisvolt-report` con SAGAs completadas, compensadas, huérfanas e inconsistentes por ambiente.
2. CloudWatch (usa el `correlation_id` que imprimió `demo-saga-fault.sh` o cópialo de la tabla de historial de la UI):

```bash
./scripts/trace-correlation.sh test saga-xxxxxxxx
```

Muestra la línea de tiempo completa en los 4 grupos `/aegisvolt/test/*`: `saga_started → connector_reserved → wallet_charged → charger_hardware_fault → saga_step_failed → wallet_refunded → connector_released → saga_compensated`.

Consulta equivalente a mano, con filtro JSON:

```bash
aws logs filter-log-events --log-group-name /aegisvolt/test/graphql-gateway \
  --filter-pattern '{ $.correlation_id = "saga-xxxxxxxx" }'
```

**Qué decir:** "Los logs son JSON estructurado con `correlation_id` (que es el `sagaId` y viaja en el header `x-correlation-id`), `environment`, `service`, `version` y `track`. Van a grupos separados por ambiente: `/aegisvolt/<env>/<servicio>`. Prefect cruza la tabla de SAGAs con las de billing y reservations: detecta huérfanas (atascadas en STARTED o COMPENSATING más de 2 min), compensaciones fallidas e inconsistencias, por ejemplo COMPENSATED con el cobro todavía CHARGED. Publica métricas en CloudWatch, en `AegisVolt/<env>/Observability`."

#### 4.2 Pregunta: "Cambie una Feature Flag en dev sin redesplegar y muestre cómo cambia el frontend de dev mientras prod permanece intacto"

**Qué mostrar:** abre **dev (8081)** y **prod (8083)** lado a lado.

```bash
./scripts/toggle-flag.sh dev ENABLE_FAST_CHARGE_BOOST false
```

O usa el botón ON/OFF en la UI de dev.

En unos 2 segundos, en dev desaparece la opción "Reserva prioritaria ultra-carga" y los conectores de 350 kW del selector. Prod no cambia.

Otra opción, más visual:

```bash
./scripts/toggle-flag.sh dev SIMULATE_CHARGER_HARDWARE_FAULT true
```

Aparece la franja naranja de advertencia solo en dev.

Para probar que no hubo redespliegue:

```bash
kubectl get pods -n aegisvolt-dev    # mismos pods, misma edad (AGE), 0 reinicios
aws dynamodb scan --table-name aegisvolt-feature-flags-prod --query 'Items[].[flagName.S,enabled.BOOL]' --output table
```

Al final, deja la flag como estaba: `./scripts/toggle-flag.sh dev ENABLE_FAST_CHARGE_BOOST true`.

#### 5.1 Frontend conectado al GraphQL de cada ambiente

**Qué decir:** "Es la misma imagen en los 3 namespaces. nginx reenvía `/graphql` al `graphql-gateway` de **su mismo namespace**, así que el frontend de dev solo habla con dev. El color de la cabecera y el badge muestran el ambiente. Consulta cada 2 s, así que el estado de conectores, flags, reservas y compensaciones se ve en tiempo real."

**Dónde está:** `frontend/nginx.conf.template`, `frontend/src/App.jsx`, `k8s/base/frontend.yaml`.

---

## Checklist final antes de entrar

- [ ] `./scripts/local-up.sh` terminó sin errores y los 3 frontends abren.
- [ ] `./scripts/tfstate-versions.sh dev` muestra **2 o más versiones**.
- [ ] Hay PRs fusionados feature→dev, dev→test y test→prod, con checks en verde.
- [ ] Hay al menos una ejecución del CD en verde (pestaña *Actions*).
- [ ] El ruleset está activo y probaste `git push --force origin test` (rechazado).
- [ ] Prefect server corriendo con al menos una ejecución completa y artefactos.
- [ ] Ensayaste `./scripts/demo-saga-fault.sh test` y `./scripts/trace-correlation.sh`.
- [ ] Ensayaste el canary OK y el canary con rollback en dev.
- [ ] Tienes memorizado el recorrido del paquete por el VPCE (1.4) y la explicación de idempotencia (3.4).

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `kind create cluster` falla | Docker Desktop no está corriendo, o le falta RAM: dale 6 GB o más en *Settings → Resources* |
| Pods en `ErrImageNeverPull` / `ImagePullBackOff` | `./scripts/build-images.sh v1` (carga las imágenes a kind) y luego `kubectl rollout restart deploy -n aegisvolt-dev` |
| Pods en CrashLoop con error de DynamoDB | ¿Floci está en la red kind? `docker network inspect kind \| grep floci`. Si no aparece: `docker compose up -d` |
| `aws` responde "Could not connect" | Ejecuta `source scripts/env.sh` y verifica que Floci esté arriba: `curl localhost:4566/_floci/info` |
| `bash\r: No such file` | Finales de línea de Windows: `git config core.autocrlf input`, borra la carpeta y vuelve a clonar |
| `terraform init` dice que el bucket no existe | Ejecuta primero `./scripts/bootstrap-backend.sh` |
| Error de lock en Terraform | `terraform -chdir=infra/envs force-unlock <LOCK_ID>` |
| Un PR no deja hacer Merge | Revisa qué check falló en *Checks*. Si es `promotion-guard`, el origen o destino del PR no corresponde al flujo |
| Quiero empezar de cero | `kind delete cluster --name aegisvolt && docker compose down && rm -rf .floci-data infra/envs/.terraform infra/bootstrap/.terraform infra/bootstrap/terraform.tfstate*` |
