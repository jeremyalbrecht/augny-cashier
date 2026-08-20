output "member_url" {
  description = "Public URL of the espace adhérent."
  value       = "https://${local.member_host}"
}

output "next_steps" {
  description = "Manual steps Terraform cannot perform."
  value       = <<-EOT
    1. In the Azure portal, add ${local.member_host} as a custom domain on the
       Static Web App. Without it, SWA rejects the Host header Cloudflare
       forwards and every request 404s.

    2. In Google Cloud Console, add this authorised redirect URI:
         https://${local.member_host}/auth/google

    No new Azure app setting is needed for storage: the app now reaches
    Firestore with the SAME service account key already in NUXT_SA — this
    Terraform run only granted that account roles/datastore.user on
    ${var.google_project_id} (see firestore.tf).
  EOT
}
