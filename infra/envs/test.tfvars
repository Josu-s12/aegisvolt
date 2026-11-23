vpc_cidr                 = "10.20.0.0/16"
log_retention_days       = 14
dynamodb_pitr            = false
dynamodb_deletion_protection = false
# API Gateway (VPC Link) reenvía al gateway GraphQL del namespace aegisvolt-test.
# Con Floci + kind: NodePort 30402 del nodo "aegisvolt-control-plane" (red docker "kind").
graphql_backend_url = "http://aegisvolt-control-plane:30402"
