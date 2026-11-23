variable "name_prefix" { type = string }
variable "environment" { type = string }
variable "region" { type = string }
variable "vpc_cidr" { type = string }
variable "availability_zones" { type = list(string) }
variable "enable_vpc_endpoints" {
  type    = bool
  default = true
}
variable "tags" {
  type    = map(string)
  default = {}
}
