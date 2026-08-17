# compte.<zone> → the Azure Static Web App.
#
# Proxied, because the URL rewrite in rewrite.tf only runs for traffic that
# actually passes through Cloudflare's edge. Set proxied = false and the
# rewrite silently stops applying — the subdomain would serve the cashier
# tablet page at its root instead of the member area.
resource "cloudflare_dns_record" "member_portal" {
  zone_id = var.cloudflare_zone_id
  name    = var.member_subdomain
  type    = "CNAME"
  content = var.azure_swa_hostname
  proxied = true
  ttl     = 1 # required to be 1 ("automatic") whenever proxied = true
  comment = "Espace adhérent — managed by Terraform (infra/dns.tf)"
}
