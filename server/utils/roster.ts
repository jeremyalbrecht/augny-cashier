// Resolving a login identifier to a player on the Joueurs roster.
//
// Pure functions over already-fetched sheet rows — same contract as debts.ts,
// so this is trivial to unit-test.
//
// Two callers with different needs:
//   - requireMember() resolves a *proven* email (from a Google session or a
//     consumed magic link) to a player.
//   - /api/member/magic/request resolves *untrusted user input*, which may be
//     either an email or a licence number.
//
// SECURITY: the magic-link email must always be sent to the address stored on
// the roster (`player.email`), never to whatever the user typed. Licence
// numbers are low-entropy and semi-public — anyone can guess one — so sending
// to user-supplied input would let an attacker hijack another member's login.

import type { JoueurRow } from "#server/utils/debts";

export interface RosterPlayer {
  /** Value of the Nom column — the key every other sheet joins on. */
  name: string;
  /** Value of the Email column, or undefined when the cell is blank. */
  email?: string;
  /** Value of the Licence column, normalised to a string. */
  licence?: string;
}

/** Lowercased + trimmed. Used for both storage and comparison of emails. */
export function normaliseEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Licence numbers arrive from the sheet as `string | number` depending on
 * whether the cell was formatted as text, and members type them with spaces or
 * leading zeros. Strip everything non-alphanumeric, uppercase, then drop
 * leading zeros so `0012345` and `12345` are the same licence.
 *
 * NOTE: debts.ts has its own, weaker `normalizeLicence` (trim only) used to
 * join `Tournois N` rows to players. Do not unify them: this one is tuned for
 * matching untrusted human input, and loosening the Tournois join could change
 * which player a tournament is attributed to — i.e. silently change what
 * people owe.
 */
export function normaliseLicence(value: unknown): string {
  const cleaned = String(value ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  // Keep at least one character — a licence of "0" must not normalise to "".
  return cleaned.replace(/^0+(?=.)/, "");
}

/** Projects raw Joueurs rows into the small shape the auth paths need. */
export function toRoster(joueurs: JoueurRow[]): RosterPlayer[] {
  const out: RosterPlayer[] = [];
  for (const row of joueurs) {
    const name = String(row.Nom ?? "").trim();
    if (!name) continue;
    const email = normaliseEmail(row.Email);
    const licence = normaliseLicence(row.Licence);
    out.push({
      name,
      email: email || undefined,
      licence: licence || undefined,
    });
  }
  return out;
}

/**
 * All players registered under a proven email address, in roster order.
 *
 * An address is an ACCOUNT, not a person: a parent commonly registers
 * themselves and their children under one address, so signing in grants access
 * to every player sharing it. (In the live roster 7 addresses are shared, one
 * by three players.) Callers must handle 0, 1 or many.
 */
export function findPlayersByEmail(
  roster: RosterPlayer[],
  email: string,
): RosterPlayer[] {
  const target = normaliseEmail(email);
  if (!target) return [];
  return roster.filter((p) => p.email === target);
}

/**
 * The first player listed under an address.
 *
 * NOT necessarily the account holder — roster order carries no such meaning,
 * and in the live sheet at least one shared address lists a child first. Use
 * this only where any linked name will do (the magic-link greeting, a session
 * display name), never to label the account as a person.
 *
 * Anything showing balances must use findPlayersByEmail, or children silently
 * disappear.
 */
export function findPlayerByEmail(
  roster: RosterPlayer[],
  email: string,
): RosterPlayer | null {
  return findPlayersByEmail(roster, email)[0] ?? null;
}

/**
 * Resolves untrusted login input. An input containing "@" is treated as an
 * email, anything else as a licence number.
 *
 * Returns the matched player even when they have no email on file — the caller
 * needs to distinguish "no such member" from "member we cannot reach", because
 * the second case deserves a server-side log while both must look identical to
 * the user.
 */
export function findPlayerByIdentifier(
  roster: RosterPlayer[],
  input: string,
): RosterPlayer | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  if (raw.includes("@")) {
    return findPlayerByEmail(roster, raw);
  }

  const licence = normaliseLicence(raw);
  if (!licence) return null;
  return roster.find((p) => p.licence === licence) ?? null;
}
