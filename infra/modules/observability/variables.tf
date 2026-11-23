variable "project" { type = string }
variable "environment" { type = string }
variable "log_retention_days" { type = number }
variable "services" { type = list(string) }
variable "tags" {
  type    = map(string)
  default = {}
}
