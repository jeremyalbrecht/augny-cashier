output "d1_database_id" {
  description = "Set as NUXT_CLOUDFLARE_D1_DATABASE_ID in the Azure app settings."
  value       = cloudflare_d1_database.members.id
}

output "d1_database_name" {
  description = "Pass to `wrangler d1 execute` when applying infra/schema.sql."
  value       = cloudflare_d1_database.members.name
}

output "member_url" {
  description = "Public URL of the espace adhérent."
  value       = "https://${local.member_host}"
}

output "next_steps" {
  description = "Manual steps Terraform cannot perform."
  value       = <<-EOT
    1. Apply the D1 schema:
         wrangler d1 execute ${cloudflare_d1_database.members.name} --remote --file=infra/schema.sql

    2. Create the RUNTIME D1 API token by hand (dashboard → My Profile → API
       Tokens), scoped to Account → D1 → Edit. It is deliberately not managed
       here: `cloudflare_api_token` would write the secret value into
       terraform.tfstate in plaintext.

    3. In the Azure portal, add ${local.member_host} as a custom domain on the
       Static Web App. Without it, SWA rejects the Host header Cloudflare
       forwards and every request 404s.

    4. In Google Cloud Console, add this authorised redirect URI:
         https://${local.member_host}/auth/google

    5. Set these Azure app settings:
         NUXT_CLOUDFLARE_ACCOUNT_ID    = ${var.cloudflare_account_id}
         NUXT_CLOUDFLARE_D1_DATABASE_ID = ${cloudflare_d1_database.members.id}
         NUXT_CLOUDFLARE_API_TOKEN     = <the token from step 2>
  EOT
}
