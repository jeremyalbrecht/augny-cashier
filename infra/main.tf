terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # v5 reworked the schema: `rules`, `action_parameters` and friends are
      # now list/object *attributes* (written with `=`) rather than repeated
      # blocks. Do not downgrade to v4 without rewriting rewrite.tf.
      version = "~> 5.23"
    }
  }
}

# The token is read from the CLOUDFLARE_API_TOKEN environment variable so it
# never lands in a committed .tfvars file. It needs:
#   Zone   → DNS        → Edit   (the compte CNAME)
#   Zone   → Zone WAF   → Edit   (the transform ruleset)
#   Account → D1        → Edit   (the database)
provider "cloudflare" {}
