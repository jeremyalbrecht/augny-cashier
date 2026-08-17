variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the D1 database."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone ID for the club domain."
  type        = string
}

variable "zone_name" {
  description = "Apex domain of the zone, e.g. augny-badminton.fr."
  type        = string
  default     = "augny-badminton.fr"
}

variable "member_subdomain" {
  description = "Subdomain hosting the espace adhérent."
  type        = string
  default     = "compte"
}

variable "azure_swa_hostname" {
  description = <<-EOT
    Default hostname of the Azure Static Web App the subdomain points at,
    e.g. purple-mushroom-0fbbcdb03.azurestaticapps.net.

    The same hostname must ALSO be registered as a custom domain inside the
    Azure portal, otherwise Static Web Apps rejects the Host header that
    Cloudflare forwards and every request 404s.
  EOT
  type        = string
}

variable "d1_database_name" {
  description = "Name of the D1 database holding magic codes and push subscriptions."
  type        = string
  default     = "augny-cashier-members"
}
