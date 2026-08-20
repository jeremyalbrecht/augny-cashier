import { getQuery, sendRedirect } from "h3";
import { fsQuery, fsPatch } from "#server/utils/firestore";
import { loadRoster } from "#server/utils/require-member";
import { findPlayerByEmail } from "#server/utils/roster";
import { hash, checkConsumable, type MagicCodeRow } from "#server/utils/magic-code";

/**
 * Window during which an already-consumed link still signs the member in.
 *
 * Mail clients and corporate link scanners (Outlook SafeLinks, antivirus
 * gateways) follow links in e-mail before any human does. With strict
 * single-use, that prefetch burns the token and the member reliably lands on
 * "lien expiré" — the link would be broken for a whole class of users.
 *
 * The security cost is small: reusing the link still requires possessing it,
 * which means access to the member's mailbox — at which point they could just
 * request a fresh one. The row's own 15-minute expiry still applies on top of
 * this, and the typed-code path stays strictly single-use.
 */
const REUSE_GRACE_MS = 5 * 60 * 1000;

// One-tap sign-in from the link in the magic e-mail.
//
// Unlike the code path this is a GET the user lands on, so failures redirect to
// /connexion with a flag rather than returning JSON. The token is high-entropy
// (32 random bytes), so unlike the 6-digit code there is no attempt counter —
// guessing it is not a realistic threat.

interface TokenRow extends MagicCodeRow {
  email: string;
}

export default defineEventHandler(async (event) => {
  const token = String(getQuery(event).token ?? "");
  if (!token) {
    return sendRedirect(event, "/connexion?error=lien-expire");
  }

  let row: TokenRow | undefined;
  let updateTime: string | undefined;
  try {
    const rows = await fsQuery<TokenRow>(event, "magic_codes", {
      where: [{ field: "token_hash", op: "EQUAL", value: hash(token) }],
      limit: 1,
    });
    if (rows[0]) {
      row = { ...rows[0].fields, id: rows[0].id };
      updateTime = rows[0].updateTime;
    }
  } catch (e) {
    console.error("[magic] token lookup failed:", e);
    return sendRedirect(event, "/connexion?error=lien-expire");
  }

  const now = Date.now();
  if (!row) {
    return sendRedirect(event, "/connexion?error=lien-expire");
  }

  const state = checkConsumable(row, now);
  if (!state.ok) {
    // Everything except a very recent consume is a hard failure. The row's own
    // expiry is checked first inside checkConsumable, so the grace window can
    // never outlive the 15-minute TTL.
    const withinGrace =
      state.reason === "already-used"
      && row.used_at != null
      && now - row.used_at < REUSE_GRACE_MS
      && now < row.expires_at;
    if (!withinGrace) {
      return sendRedirect(event, "/connexion?error=lien-expire");
    }
  } else {
    // First use — consume atomically. The `ifUpdateTime` precondition is what
    // makes the claim race-free when two requests arrive together.
    const changed = await fsPatch(event, "magic_codes", row.id, { used_at: now }, { ifUpdateTime: updateTime });
    if (!changed) {
      // Lost the race to a concurrent request (typically the mail client's
      // prefetch landing microseconds earlier). That is exactly the case the
      // grace window exists for, so let it through.
      const stillFresh = now < row.expires_at;
      if (!stillFresh) {
        return sendRedirect(event, "/connexion?error=lien-expire");
      }
    }
  }

  // Re-resolve the player so the session carries their current roster name,
  // and so a member removed from the roster since the mail was sent can't sign
  // in with a still-valid link.
  const roster = await loadRoster(event);
  const player = findPlayerByEmail(roster, row.email);
  if (!player) {
    return sendRedirect(event, "/connexion?error=lien-expire");
  }

  await setUserSession(event, {
    user: { email: player.email ?? row.email, name: player.name },
    loggedInAt: Date.now(),
  });

  return sendRedirect(event, "/mon-compte");
});
