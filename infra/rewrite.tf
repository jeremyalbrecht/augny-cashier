locals {
  member_host = "${var.member_subdomain}.${var.zone_name}"
}

# Azure Static Web Apps has no host-based routing — staticwebapp.config.json
# matches paths, not hostnames — so pointing a second domain at the same app
# would serve the cashier tablet page at its root. This rewrites the root of the
# member subdomain to the member page at Cloudflare's edge instead.
#
# A Transform Rule (free plan) rather than a Worker: it's a path rewrite, which
# is exactly what this product does, and it costs nothing.
#
# Only the exact root path is rewritten. Everything else must pass through
# untouched — /auth/google (OAuth callback), /api/* and /connexion all need to
# reach the app at their real paths. The app is an SPA (ssr: false), so once
# the root loads, client-side routing takes over and no further rewrites are
# needed.
resource "cloudflare_ruleset" "member_host_rewrite" {
  zone_id     = var.cloudflare_zone_id
  name        = "Espace adhérent — root rewrite"
  description = "Serve /mon-compte at the root of ${local.member_host}"
  kind        = "zone"
  phase       = "http_request_transform"

  rules = [
    {
      ref         = "member_root_rewrite"
      description = "Rewrite / to /mon-compte on ${local.member_host}"
      expression  = "(http.host eq \"${local.member_host}\" and http.request.uri.path eq \"/\")"
      action      = "rewrite"
      enabled     = true

      action_parameters = {
        uri = {
          path = {
            value = "/mon-compte"
          }
        }
      }
    }
  ]
}
