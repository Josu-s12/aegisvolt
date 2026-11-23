variable "project" { type = string }
variable "environment" { type = string }
variable "pitr_enabled" { type = bool }
variable "deletion_protection" { type = bool }
variable "seed_file" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
