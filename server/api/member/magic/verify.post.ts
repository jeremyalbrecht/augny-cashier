import { createError, readBody } from "h3";
import { d1Query, d1Execute } from "#server/utils/d1";
import { loadRoster } from "#server/utils/require-member";
import { findPlayerByIdentifier } from "#server/utils/roster";
import { verifyCode, type MagicCodeRow } from "#server/utils/magic-code";

// Exchange a 6-digit code for a session.
//
// Every failure returns the same 400 with the same message. Distinguishing
// "wrong code" from "no such member" would reintroduce the enumeration oracle
// that request.post.ts is careful to avoid.

const GENERIC_ERROR = "Code invalide ou expiré";

interface VerifyBody {
  identifier?: string;
  code?: string;
}

function fail(): never {
  throw createError({ statusCode: 400, statusMessage: GENERIC_ERROR });
}

export default defineEventHandler(async (event) => {
  const body = (await readBody<VerifyBody>(event)) ?? {};
  const identifier = String(body.identifier ?? "").trim();
  const code = String(body.code ?? "").trim();
  if (!identifier || !code) fail();

  const roster = await loadRoster(event);
  const player = findPlayerByIdentifier(roster, identifier);
  if (!player?.email) fail();

  // Most recent code for this address. Older ones stay in the table but are
  // effectively dead: requesting a new code is the documented way to recover.
  const rows = await d1Query<MagicCodeRow>(
    event,
    `SELECT id, code_hash, token_hash, expires_at, used_at, attempts
       FROM magic_codes
      WHERE email = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [player.email],
  );
  const row = rows[0];
  if (!row) fail();

  const result = verifyCode(row, code, Date.now());

  if (!result.ok) {
    if (result.reason === "wrong-code") {
      // Count the miss so a 6-digit code can't be brute-forced. Best-effort:
      // a failed counter update must not turn into a 500.
      await d1Execute(event, "UPDATE magic_codes SET attempts = attempts + 1 WHERE id = ?", [
        row.id,
      ]).catch((e) => console.error("[magic] failed to record attempt:", e));
    }
    fail();
  }

  // Consume atomically. `used_at IS NULL` in the WHERE clause is what makes
  // single-use real: if two requests race, exactly one sees changes === 1.
  const changed = await d1Execute(
    event,
    "UPDATE magic_codes SET used_at = ? WHERE id = ? AND used_at IS NULL",
    [Date.now(), row.id],
  );
  if (changed !== 1) fail();

  await setUserSession(event, {
    user: { email: player.email, name: player.name },
    loggedInAt: Date.now(),
  });

  return { ok: true as const };
});
