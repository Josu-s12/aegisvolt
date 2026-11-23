vpc_cidr                 = "10.30.0.0/16"
log_retention_days       = 30
dynamodb_pitr            = true
dynamodb_deletion_protection = true
# API Gateway (VPC Link) reenvía al gateway GraphQL del namespace aegisvolt-prod.
# Con Floci + kind: NodePort 30403 del nodo "aegisvolt-control-plane" (red docker "kind").
graphql_backend_url = "http://aegisvolt-control-plane:30403"
