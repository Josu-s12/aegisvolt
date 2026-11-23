# Variables específicas del ambiente dev (workspace "dev")
vpc_cidr                 = "10.10.0.0/16"
log_retention_days       = 7
dynamodb_pitr            = false
dynamodb_deletion_protection = false
# API Gateway (VPC Link) reenvía al gateway GraphQL del namespace aegisvolt-dev.
# Con Floci + kind: NodePort 30401 del nodo "aegisvolt-control-plane" (red docker "kind").
graphql_backend_url = "http://aegisvolt-control-plane:30401"
