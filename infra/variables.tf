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

variable "google_project_id" {
  description = <<-EOT
    GCP project holding the Firestore database. Same project as the service
    account already used for Sheets access (NUXT_SA) — read its "project_id"
    field to find this value.
  EOT
  type        = string
}

variable "firestore_location" {
  description = <<-EOT
    Firestore location — a region or multi-region, e.g. "eur3" (Europe) or
    "eur3"/"nam5". Cannot be changed after the database is created.
  EOT
  type        = string
  default     = "eur3"
}

variable "service_account_email" {
  description = <<-EOT
    E-mail of the service account the app runs as (the one whose key is
    base64-encoded into NUXT_SA). Granted roles/datastore.user on the project
    so the app can read/write Firestore.
  EOT
  type        = string
}
