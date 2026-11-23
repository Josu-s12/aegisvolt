variable "project" {
  type    = string
  default = "aegisvolt"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "use_floci" {
  description = "true = emulador local Floci; false = AWS real"
  type        = bool
  default     = true
}

variable "floci_endpoint" {
  type    = string
  default = "http://localhost:4566"
}

variable "vpc_cidr" {
  description = "CIDR de la VPC del ambiente (distinto por ambiente: 10.10/10.20/10.30)"
  type        = string
}

variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}

variable "enable_vpc_endpoints" {
  type    = bool
  default = true
}

variable "dynamodb_pitr" {
  description = "Point-in-time recovery de las tablas (true en prod)"
  type        = bool
  default     = false
}

variable "dynamodb_deletion_protection" {
  description = "Protección contra borrado de tablas (true en prod)"
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type    = number
  default = 7
}

variable "services" {
  description = "Microservicios con grupo de logs propio en CloudWatch"
  type        = list(string)
  default = [
    "station-reservation-service",
    "billing-wallet-service",
    "energy-dispatch-service",
    "graphql-gateway",
  ]
}

variable "enable_eks" {
  description = "Crea el clúster EKS (en Floci se emula con k3s; con FLOCI_SERVICES_EKS_MOCK=true solo la API)"
  type        = bool
  default     = true
}

variable "kubernetes_version" {
  type    = string
  default = "1.31"
}

variable "node_instance_type" {
  type    = string
  default = "t3.medium"
}

variable "node_count" {
  type    = number
  default = 2
}

variable "graphql_backend_url" {
  description = "URL del gateway GraphQL detrás del VPC Link (NodePort/NLB del clúster)"
  type        = string
}
