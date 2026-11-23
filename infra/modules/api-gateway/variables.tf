variable "name_prefix" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "execute_api_vpce_id" {
  type    = string
  default = null
}
variable "graphql_backend_url" { type = string }
variable "use_floci" { type = bool }
variable "tags" {
  type    = map(string)
  default = {}
}
