import { createError, readBody } from "h3";
import { fsQuery, fsPatch } from "#server/utils/firestore";
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
  // Strip all whitespace, not just leading/trailing: the e-mail renders the
  // code letter-spaced ("1 2 3 4 5 6") for readability, so a pasted code
  // carries internal spaces even after the UI's own input filtering.
  const code = String(body.code ?? "").replace(/\s/g, "");
  if (!identifier || !code) fail();

  const roster = await loadRoster(event);
  const player = findPlayerByIdentifier(roster, identifier);
  if (!player?.email) fail();

  // Most recent code for this address. Older ones stay in the table but are
  // effectively dead: requesting a new code is the documented way to recover.
  const rows = await fsQuery<MagicCodeRow>(event, "magic_codes", {
    where: [{ field: "email", op: "EQUAL", value: player.email }],
    orderBy: [{ field: "created_at", direction: "DESCENDING" }],
    limit: 1,
  });
  const doc = rows[0];
  if (!doc) fail();
  const row: MagicCodeRow = { ...doc.fields, id: doc.id };

  const result = verifyCode(row, code, Date.now());

  if (!result.ok) {
    if (result.reason === "wrong-code") {
      // Count the miss so a 6-digit code can't be brute-forced. Best-effort:
      // a failed counter update must not turn into a 500.
      await fsPatch(event, "magic_codes", row.id, { attempts: row.attempts + 1 }).catch((e) =>
        console.error("[magic] failed to record attempt:", e),
      );
    }
    fail();
  }

  // Consume atomically. The `ifUpdateTime` precondition is what makes
  // single-use real: if two requests race, exactly one wins the compare-and-
  // swap and the loser gets `false` back.
  const changed = await fsPatch(
    event,
    "magic_codes",
    row.id,
    { used_at: Date.now() },
    { ifUpdateTime: doc.updateTime },
  );
  if (!changed) fail();

  await setUserSession(event, {
    user: { email: player.email, name: player.name },
    loggedInAt: Date.now(),
  });

  return { ok: true as const };
});
