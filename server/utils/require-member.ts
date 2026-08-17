import { createError, type H3Event } from "h3";
import { getSheetData } from "#server/utils/fetch";
import { findPlayersByEmail, toRoster, type RosterPlayer } from "#server/utils/roster";
import type { JoueurRow } from "#server/utils/debts";

// Third auth tier: the member themselves. See CLAUDE.md.
//
// Unlike requireAdmin (Comité allowlist), membership is decided by the Joueurs
// roster. Sign-in itself is never blocked — any Google account may complete
// OAuth — so an authenticated-but-unrecognised session is an ordinary state
// here, not an attack. It gets a distinct status message so the UI can show
// "contacte le comité" rather than a generic error.

const CACHE_TTL_MS = 60_000;
let cache: { fetchedAt: number; roster: RosterPlayer[] } | null = null;

/** Roster of every player, cached for 60s — same trade-off as require-admin.ts. */
export async function loadRoster(event: H3Event): Promise<RosterPlayer[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.roster;

  const spreadsheetId = process.env.GOOGLE_SHEET_ID || "";
  const { sa } = useRuntimeConfig(event);
  const rows = (await getSheetData({
    spreadsheetId,
    range: "Joueurs!A1:Z1000",
    credentialsRaw: sa,
  })) as JoueurRow[];

  const roster = toRoster(rows);
  cache = { fetchedAt: now, roster };
  return roster;
}

/** Status message for a logged-in session whose email isn't on the roster.
 *  Exported so callers can distinguish it from a plain 403. */
export const NOT_ON_ROSTER = "Not on roster";

export interface Member {
  email: string;
  /** Every player registered under this address — parent plus any children. */
  players: RosterPlayer[];
  /** Convenience: the same names, for `IN (…)` queries. */
  names: string[];
  /** First player listed under the address. Display fallback only — roster
   *  order does not identify the account holder. */
  primaryName: string;
}

/**
 * Guard for member-only routes. Requires a session (Google OAuth or a consumed
 * magic link) whose email matches at least one Joueurs row.
 *
 * Returns ALL players on that address, not just one — an address is an account
 * that may cover a parent and their children. Callers that act per-player
 * (push subscriptions, balances) must iterate `players`.
 *
 * Throws 401 when not signed in, 403 with `NOT_ON_ROSTER` when signed in but
 * unrecognised.
 */
export async function requireMember(event: H3Event): Promise<Member> {
  const session = await getUserSession(event);
  const email = session?.user?.email;
  if (!email) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const roster = await loadRoster(event);
  const players = findPlayersByEmail(roster, email);
  if (players.length === 0) {
    throw createError({ statusCode: 403, statusMessage: NOT_ON_ROSTER });
  }

  return {
    email,
    players,
    names: players.map((p) => p.name),
    primaryName: players[0]!.name,
  };
}
