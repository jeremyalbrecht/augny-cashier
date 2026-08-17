import { loadAllBalances } from "#server/utils/load-debts";
import { loadRoster } from "#server/utils/require-member";
import { findPlayersByEmail } from "#server/utils/roster";
import { createError } from "h3";

// The member's own balance. Deliberately does NOT use requireMember():
//
// Any Google account can complete sign-in — we never gate OAuth on roster
// membership — so "signed in but not a member" is a normal, expected state that
// deserves a friendly screen rather than a 403. This endpoint therefore
// requires only a session and reports `recognised: false` for unknown emails.
//
// Telling a signed-in user that *their own* address isn't on the roster is not
// an enumeration leak: they proved ownership of that mailbox by signing in, and
// the response reveals nothing about anyone else. (The magic-link endpoints,
// which take untrusted input, are a different matter and stay generic.)

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event);
  const email = session?.user?.email;
  if (!email) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const roster = await loadRoster(event);
  // An address is an account: a parent typically registers themselves and
  // their children under one e-mail, so this can legitimately return several.
  const linked = findPlayersByEmail(roster, email);
  if (linked.length === 0) {
    // No balance data in the payload at all — not merely hidden by the UI.
    return { recognised: false as const, email };
  }

  const { balances, cutoffDate } = await loadAllBalances(event);
  const players = linked
    .map((p) => balances.find((b) => b.name === p.name))
    .filter((b): b is NonNullable<typeof b> => b != null);

  if (players.length === 0) {
    // computeBalances seeds a row for every Joueurs entry with a Nom, so this
    // means the roster cache is stale relative to the sheet (players renamed or
    // removed mid-session). Treat as unrecognised rather than 500.
    return { recognised: false as const, email };
  }

  return {
    recognised: true as const,
    email,
    players,
    /** Sum across everyone on the account — what the household owes in total. */
    combinedTotal: players.reduce((sum, p) => sum + p.total, 0),
    cutoffDate: cutoffDate ? cutoffDate.toISOString().slice(0, 10) : null,
  };
});
