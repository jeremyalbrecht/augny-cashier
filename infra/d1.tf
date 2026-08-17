# Machine-generated auth state that has no business being in a spreadsheet:
# magic-link codes (need TTLs and atomic single-use), push subscriptions, and
# the reminder log. The club's actual business data — Joueurs, Dettes, Tournois,
# Paiements, Envois — stays in Google Sheets where the treasurer can edit it.
#
# The app runs on Azure and reaches this over the D1 REST API, so there is no
# Workers binding. Latency is irrelevant here: a magic code is verified about
# once a month per member and subscriptions are read only when sending pushes.
resource "cloudflare_d1_database" "members" {
  account_id = var.cloudflare_account_id
  name       = var.d1_database_name
}

# Terraform has no resource for applying SQL to D1, so the schema is applied
# out of band. After `terraform apply`:
#
#   wrangler d1 execute ${var.d1_database_name} --remote --file=infra/schema.sql
#
# The schema is idempotent (CREATE TABLE IF NOT EXISTS), so re-running is safe.
