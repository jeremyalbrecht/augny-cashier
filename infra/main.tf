terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.23"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

# The token is read from the CLOUDFLARE_API_TOKEN environment variable so it
# never lands in a committed .tfvars file. It needs just:
#   Zone → DNS → Edit   (the compte CNAME)
#
# No Transform Rules permission: the root-path rewrite that used to need it
# (infra/rewrite.tf) moved server-side — see
# server/middleware/member-host-rewrite.ts — because Azure's CNAME-based
# custom-domain validation and a Cloudflare-proxied record are mutually
# exclusive, and the rewrite only ever worked on proxied traffic.
provider "cloudflare" {}

# Credentials read from GOOGLE_APPLICATION_CREDENTIALS (a path to a service
# account key with Editor or equivalent on the project) or gcloud's
# application-default-login, per the provider's usual resolution order. This
# is a separate, human-held credential — NOT the app's runtime service
# account (NUXT_SA), which only ever gets the narrow `roles/datastore.user`
# grant in firestore.tf.
provider "google" {
  project = var.google_project_id
}
