// Who deserves a payment reminder.
//
// Pure over already-fetched data — same contract as debts.ts — so the rules are
// unit-testable without D1 or Sheets.
//
// The rule: a member is a candidate when at least one invoice the club sent
// them is still unpaid and is old enough to have been reasonably actioned, and
// we haven't already nagged them recently.

import { parseSheetDate } from "#server/utils/debts";
import type { PlayerBalance } from "#server/utils/debts";

/** An invoice must be this old before it counts as overdue. */
export const REMINDER_AFTER_DAYS = 14;

/** Minimum gap between two reminders to the same member. */
export const REMINDER_COOLDOWN_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReminderCandidate {
  name: string;
  email?: string;
  /** Amount still outstanding across all invoices sent to them. */
  outstanding: number;
  /** Date of the oldest still-unpaid invoice, as it appears in the sheet. */
  oldestUnpaidDate: string;
  /** Whole days since that invoice was sent. */
  daysOverdue: number;
}

/** Timestamp of the last reminder sent to each player. */
export type ReminderLog = Map<string, number>;

/**
 * Selects members to remind.
 *
 * Deliberately driven by `unpaidInvoices` (the FIFO walk in computeBalances)
 * rather than by `total`: a member can owe money for purchases made yesterday
 * without ever having been invoiced, and chasing them for that would be unfair
 * — they've had no bill yet.
 *
 * Invoices whose date can't be parsed are skipped rather than treated as
 * infinitely old. Over-billing is the safer error in debts.ts, but
 * over-*nagging* is not: a bad date in the sheet shouldn't spam a member.
 */
export function selectReminderCandidates(
  balances: PlayerBalance[],
  remindersSent: ReminderLog,
  now: number = Date.now(),
): ReminderCandidate[] {
  const overdueBefore = now - REMINDER_AFTER_DAYS * DAY_MS;
  const cooldownStart = now - REMINDER_COOLDOWN_DAYS * DAY_MS;

  const out: ReminderCandidate[] = [];

  for (const player of balances) {
    if (player.unpaidInvoices.length === 0) continue;
    if (player.outstandingFromInvoices <= 0.005) continue;

    const lastReminded = remindersSent.get(player.name);
    if (lastReminded != null && lastReminded > cooldownStart) continue;

    // Oldest unpaid invoice with a usable date.
    let oldestTs: number | null = null;
    let oldestRaw: string | null = null;
    for (const inv of player.unpaidInvoices) {
      const d = parseSheetDate(inv.date);
      if (!d) continue;
      const ts = d.getTime();
      if (oldestTs == null || ts < oldestTs) {
        oldestTs = ts;
        oldestRaw = inv.date;
      }
    }

    if (oldestTs == null || oldestRaw == null) continue;
    if (oldestTs > overdueBefore) continue;

    out.push({
      name: player.name,
      email: player.email,
      outstanding: player.outstandingFromInvoices,
      oldestUnpaidDate: oldestRaw,
      daysOverdue: Math.floor((now - oldestTs) / DAY_MS),
    });
  }

  // Longest-overdue first — that's the order a treasurer scanning the list
  // cares about.
  out.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return out;
}
