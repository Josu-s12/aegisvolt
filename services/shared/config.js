// Configuración común a todos los microservicios.
// El ambiente (dev | test | prod) llega por la variable APP_ENV, que en Kubernetes
// la inyecta el ConfigMap del overlay de cada namespace. Así el MISMO contenedor
// sirve para los tres ambientes y solo cambia la configuración (12-factor).

const VALID_ENVS = ['dev', 'test', 'prod'];

export const APP_ENV = process.env.APP_ENV || 'dev';
if (!VALID_ENVS.includes(APP_ENV)) {
  throw new Error(`APP_ENV inválido: ${APP_ENV}. Debe ser uno de ${VALID_ENVS.join(', ')}`);
}

export const APP_VERSION = process.env.APP_VERSION || 'local';
// stable | canary -> lo pone el Deployment de Kubernetes (label "track")
export const APP_TRACK = process.env.APP_TRACK || 'stable';
export const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
// Si existe, apuntamos el SDK a Floci (emulador local de AWS). En AWS real se deja vacío.
export const AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || undefined;
export const PROJECT = process.env.PROJECT_NAME || 'aegisvolt';

// Patrón Database-per-Service + separación por ambiente:
//   aegisvolt-reservations-dev, aegisvolt-billing-test, aegisvolt-dispatch-prod ...
// Es exactamente el mismo nombre que genera Terraform con ${terraform.workspace}.
export function tableName(base) {
  return `${PROJECT}-${base}-${APP_ENV}`;
}

export const TABLES = {
  reservations: tableName('reservations'),
  billing: tableName('billing'),
  dispatch: tableName('dispatch'),
  sagas: tableName('sagas'),
  flags: tableName('feature-flags'),
};

// Grupo de logs de CloudWatch por ambiente: /aegisvolt/dev/<servicio>
export function logGroupName(service) {
  return `/${PROJECT}/${APP_ENV}/${service}`;
}
