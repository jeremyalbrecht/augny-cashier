-- D1 schema for the espace adhérent.
--
-- Apply with:
--   wrangler d1 execute augny-cashier-members --remote --file=infra/schema.sql
--
-- Idempotent — safe to re-run.
--
-- Everything here is machine-generated throwaway state. Nothing a human would
-- ever want to read or edit belongs in this database; that all stays in the
-- "Dettes adhérents" Google Sheet.

-- ---------------------------------------------------------------------------
-- Magic-link codes.
--
-- `email` is always the address stored on the Joueurs roster, never what the
-- user typed. Codes and tokens are stored as SHA-256 hashes so a dump of this
-- table can't be used to log in as anyone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS magic_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL,
  code_hash   TEXT    NOT NULL,
  token_hash  TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_magic_codes_email ON magic_codes (email, created_at);
CREATE INDEX IF NOT EXISTS idx_magic_codes_token ON magic_codes (token_hash);
-- Supports the self-cleaning DELETE in /api/member/magic/request, which runs
-- on every issued code. Without it that delete is a full table scan.
CREATE INDEX IF NOT EXISTS idx_magic_codes_expires ON magic_codes (expires_at);

-- ---------------------------------------------------------------------------
-- Rate limiting, keyed by a hash of whatever the user typed.
--
-- Separate from magic_codes on purpose: this counts *attempts*, including ones
-- that matched no player. Counting only issued codes would let an attacker
-- probe unlimited licence numbers for free, and licence numbers are
-- low-entropy and semi-public.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS magic_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier_hash TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_magic_requests ON magic_requests (identifier_hash, created_at);
-- The leading column above is identifier_hash, so it can't serve a range scan
-- on created_at alone. This one backs the self-cleaning DELETE — and this is
-- the table an attacker can grow, so keeping the cleanup cheap matters most here.
CREATE INDEX IF NOT EXISTS idx_magic_requests_created ON magic_requests (created_at);

-- ---------------------------------------------------------------------------
-- Web push subscriptions. One row per browser/device, so a member may have
-- several. `endpoint` is unique — re-subscribing the same browser updates the
-- existing row rather than duplicating it.
-- ---------------------------------------------------------------------------
-- One row per (player, device). A parent who registers their children under
-- one e-mail gets a row per child on the same endpoint, so a reminder aimed at
-- the child reaches the parent's phone — which is the only device that exists.
--
-- Hence the UNIQUE is on the PAIR, not on endpoint alone: one endpoint
-- legitimately serves several players. sendPushToPlayers de-duplicates by
-- endpoint so a household targeted for two players still gets one buzz.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name     TEXT    NOT NULL,
  email           TEXT    NOT NULL,
  endpoint        TEXT    NOT NULL,
  p256dh          TEXT    NOT NULL,
  auth            TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  last_success_at INTEGER,
  failure_count   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (player_name, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subs_player ON push_subscriptions (player_name);
-- Backs the delete-by-endpoint paths (unsubscribe, and pruning a dead endpoint
-- across every player it served).
CREATE INDEX IF NOT EXISTS idx_push_subs_endpoint ON push_subscriptions (endpoint);

-- ---------------------------------------------------------------------------
-- Reminder log, so the manual "Relances" button can't notify the same person
-- twice in a week.
--
-- Deliberately NOT the Envois sheet: that sheet is the invoice ledger, and the
-- FIFO unpaid-invoice walk in server/utils/debts.ts reads it. Reminder rows
-- there would be counted as invoices and corrupt everyone's balance.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminders_sent (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name TEXT    NOT NULL,
  sent_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_player ON reminders_sent (player_name, sent_at);
