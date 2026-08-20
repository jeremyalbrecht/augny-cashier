# Machine-generated auth state that has no business being in a spreadsheet:
# magic-link codes (need atomic single-use), push subscriptions, and the
# reminder log. The club's actual business data — Joueurs, Dettes, Tournois,
# Paiements, Envois — stays in Google Sheets where the treasurer can edit it.
#
# Runs on the SAME service account already used for Sheets (NUXT_SA) — no new
# secret to create or rotate. This replaced Cloudflare D1 specifically because
# a Cloudflare API token can't be scoped below "every D1 database in the
# account"; Google IAM roles are scoped to a GCP project, and this project is
# already dedicated to this app, so it's no broader a grant than the Sheets
# access already in place.
#
# Free-tier Firestore does NOT support TTL-based auto-deletion (that needs
# billing enabled) — not a regression versus D1, which never had server-side
# TTL either. Expiry has always been enforced in application code
# (magic-code.ts's checkConsumable) with best-effort delete-on-write cleanup.
resource "google_project_service" "firestore" {
  project            = var.google_project_id
  service            = "firestore.googleapis.com"
  disable_on_destroy = false
}

resource "google_firestore_database" "members" {
  project     = var.google_project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.firestore]
}

# Grants the app's existing service account read/write access to Firestore.
# This is a project-wide grant (Google has no finer-grained "this database
# only" scope, same limitation Cloudflare has for D1) — acceptable here
# because this GCP project holds nothing but this club's data.
resource "google_project_iam_member" "app_datastore_access" {
  project = var.google_project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${var.service_account_email}"
}

# Composite indexes Firestore can't build automatically. A query filtering on
# one field while ordering/ranging on another always needs one — single-field
# equality-only or range-only queries don't (server/utils/firestore.ts's
# fsQuery callers document which is which).
resource "google_firestore_index" "magic_codes_by_email" {
  project    = var.google_project_id
  database   = google_firestore_database.members.name
  collection = "magic_codes"

  fields {
    field_path = "email"
    order      = "ASCENDING"
  }
  fields {
    field_path = "created_at"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "magic_requests_by_identifier" {
  project    = var.google_project_id
  database   = google_firestore_database.members.name
  collection = "magic_requests"

  fields {
    field_path = "identifier_hash"
    order      = "ASCENDING"
  }
  fields {
    field_path = "created_at"
    order      = "ASCENDING"
  }
}

# Backs unsubscribe.post.ts's delete (endpoint == X AND player_name IN [...]).
resource "google_firestore_index" "push_subscriptions_by_endpoint_and_player" {
  project    = var.google_project_id
  database   = google_firestore_database.members.name
  collection = "push_subscriptions"

  fields {
    field_path = "endpoint"
    order      = "ASCENDING"
  }
  fields {
    field_path = "player_name"
    order      = "ASCENDING"
  }
}
