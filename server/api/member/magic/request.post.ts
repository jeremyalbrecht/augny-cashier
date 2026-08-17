import { readBody } from "h3";
import { d1Query, d1Execute } from "#server/utils/d1";
import { loadRoster } from "#server/utils/require-member";
import { findPlayerByIdentifier } from "#server/utils/roster";
import { renderMagicLinkEmail } from "#server/utils/email-template";
import { sendHtmlEmail } from "#server/utils/mailer";
import {
  generateCode,
  generateToken,
  hash,
  expiryFrom,
  withinRateLimit,
  CODE_TTL_MS,
  RATE_WINDOW_MS,
} from "#server/utils/magic-code";
import { getRequestProtocol, getRequestHost } from "h3";

// Issue a magic-link code. Unauthenticated by necessity — this is how a member
// without a Google account gets a session in the first place.
//
// ANTI-ENUMERATION CONTRACT (the whole design hinges on this):
//   Every outcome — unknown identifier, known identifier, known identifier with
//   no e-mail on file, rate-limited — returns the SAME status and the SAME body.
//   Licence numbers are low-entropy and semi-public, so a distinguishable
//   response would turn this endpoint into a roster-scraping oracle.
//
//   Corollary: the e-mail always goes to the address stored on the Joueurs
//   sheet, NEVER to anything the caller supplied. Otherwise anyone who guessed
//   a licence number could redirect that member's login to their own inbox.

const GENERIC_RESPONSE = { ok: true as const };

interface RequestBody {
  identifier?: string;
}

/**
 * Self-cleaning: issuing a code is the only event that grows these tables, so
 * it's also where we shrink them. No cron, no maintenance job.
 *
 * Retention is set by what still has to work, not by taste:
 *
 *   magic_codes — anything past `expires_at` is dead to every read path.
 *     /auth/magic's REUSE_GRACE_MS window additionally requires
 *     `now < expires_at`, so it can never want a row this deletes. A member
 *     clicking a link we've pruned sees the same "lien expiré" redirect they'd
 *     get from the expiry check itself.
 *
 *   magic_requests — rows outside RATE_WINDOW_MS are already filtered out by
 *     withinRateLimit(), so keeping them only inflates the table an attacker
 *     can write to. A margin is kept so a request racing the window boundary
 *     can't have its own history deleted out from under it.
 *
 * Best-effort throughout: a failed cleanup must never cost someone their login.
 */
async function pruneExpired(event: Parameters<typeof d1Execute>[0], now: number): Promise<void> {
  const RETENTION_MARGIN_MS = 5 * 60 * 1000;
  try {
    await d1Execute(event, "DELETE FROM magic_codes WHERE expires_at < ?", [now]);
    await d1Execute(event, "DELETE FROM magic_requests WHERE created_at < ?", [
      now - RATE_WINDOW_MS - RETENTION_MARGIN_MS,
    ]);
  } catch (e) {
    console.error("[magic] cleanup of expired rows failed:", e);
  }
}

export default defineEventHandler(async (event) => {
  const body = (await readBody<RequestBody>(event)) ?? {};
  const identifier = String(body.identifier ?? "").trim();
  if (!identifier) return GENERIC_RESPONSE;

  // Rate-limit on a hash of the raw input. Hashing keeps e-mail addresses out
  // of the table; keying on the *input* (not the resolved player) is what makes
  // probing a range of licence numbers expensive.
  const identifierHash = hash(identifier.toLowerCase());
  const now = Date.now();

  try {
    const recent = await d1Query<{ created_at: number }>(
      event,
      "SELECT created_at FROM magic_requests WHERE identifier_hash = ? AND created_at > ?",
      [identifierHash, now - RATE_WINDOW_MS],
    );
    if (!withinRateLimit(recent.map((r) => r.created_at), now)) {
      // Silently drop — a rate-limit message would itself confirm that someone
      // has been probing this identifier.
      console.warn("[magic] rate limit hit for an identifier");
      return GENERIC_RESPONSE;
    }
    await d1Execute(
      event,
      "INSERT INTO magic_requests (identifier_hash, created_at) VALUES (?, ?)",
      [identifierHash, now],
    );
  } catch (e) {
    // A D1 outage must not become a login outage; log and carry on without
    // rate limiting rather than locking every member out.
    console.error("[magic] rate-limit check failed:", e);
  }

  const roster = await loadRoster(event);
  const player = findPlayerByIdentifier(roster, identifier);

  if (!player) {
    return GENERIC_RESPONSE;
  }
  if (!player.email) {
    // Recoverable data problem: the member exists but the club has no address
    // for them, so they can never log in and will never know why. Log it so a
    // treasurer can fix the sheet — but tell the user nothing.
    console.warn(`[magic] no e-mail on file for player "${player.name}" — cannot send magic link`);
    return GENERIC_RESPONSE;
  }

  const { smtp } = useRuntimeConfig(event);
  if (!smtp?.user || !smtp?.password) {
    console.error("[magic] SMTP not configured — cannot send magic link");
    return GENERIC_RESPONSE;
  }

  const code = generateCode();
  const token = generateToken();

  try {
    await d1Execute(
      event,
      `INSERT INTO magic_codes (email, code_hash, token_hash, expires_at, used_at, attempts, created_at)
       VALUES (?, ?, ?, ?, NULL, 0, ?)`,
      [player.email, hash(code), hash(token), expiryFrom(now), now],
    );
  } catch (e) {
    console.error("[magic] failed to store code:", e);
    return GENERIC_RESPONSE;
  }

  await pruneExpired(event, now);

  const origin = `${getRequestProtocol(event)}://${getRequestHost(event)}`;
  const link = `${origin}/auth/magic?token=${encodeURIComponent(token)}`;

  try {
    await sendHtmlEmail(
      { user: smtp.user as string, password: smtp.password as string },
      player.email,
      "Ton code de connexion — Augny Badminton",
      renderMagicLinkEmail({
        name: player.name,
        code,
        link,
        expiresInMinutes: Math.round(CODE_TTL_MS / 60000),
      }),
    );
  } catch (e) {
    console.error("[magic] failed to send e-mail:", e);
  }

  return GENERIC_RESPONSE;
});
