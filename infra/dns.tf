locals {
  member_host = "${var.member_subdomain}.${var.zone_name}"
}

# compte.<zone> → the Azure Static Web App.
#
# NOT proxied (grey cloud). Azure Static Web Apps' CNAME-based custom-domain
# validation requires this record to resolve literally to the SWA hostname —
# a proxied (orange-cloud) record resolves to Cloudflare's own IPs instead,
# which Azure rejects. The root-path rewrite that used to require proxying
# (serving /mon-compte at "/") is now a client-side redirect instead — see
# app/middleware/member-host.global.ts — so proxying isn't needed here at all.
resource "cloudflare_dns_record" "member_portal" {
  zone_id = var.cloudflare_zone_id
  name    = var.member_subdomain
  type    = "CNAME"
  content = var.azure_swa_hostname
  proxied = false
  ttl     = 3600
  comment = "Espace adhérent — managed by Terraform (infra/dns.tf)"
}
