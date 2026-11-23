variable "name_prefix" { type = string }
variable "environment" { type = string }
variable "kubernetes_version" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "cluster_sg_id" { type = string }
variable "node_instance_type" { type = string }
variable "node_count" { type = number }
variable "endpoint_public_access" {
  description = "Acceso público al API server (true para poder usar kubectl desde el portátil)"
  type        = bool
  default     = true
}
variable "tags" {
  type    = map(string)
  default = {}
}
