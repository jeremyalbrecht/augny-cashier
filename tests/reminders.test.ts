import { describe, it, expect } from "vitest";
import {
  selectReminderCandidates,
  REMINDER_AFTER_DAYS,
  REMINDER_COOLDOWN_DAYS,
  type ReminderLog,
} from "../server/utils/reminders";
import type { PlayerBalance, InvoiceLine } from "../server/utils/debts";

const DAY = 24 * 60 * 60 * 1000;
// Fixed "now": 1 March 2026, midday, so day arithmetic never straddles a DST
// change in a way that shifts a boundary test.
const NOW = new Date("2026-03-01T12:00:00Z").getTime();

/** DD/MM/YYYY for a date N days before NOW — the format the Envois sheet uses. */
function daysAgo(n: number): string {
  const d = new Date(NOW - n * DAY);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function player(overrides: Partial<PlayerBalance> = {}): PlayerBalance {
  const unpaid: InvoiceLine[] = overrides.unpaidInvoices ?? [];
  return {
    name: "Alice Martin",
    email: "alice@example.com",
    licence: "12345",
    purchasesTotal: 0,
    tournamentsTotal: 0,
    paymentsTotal: 0,
    lines: [],
    tournaments: [],
    payments: [],
    invoicesTotal: 0,
    paymentsTotalAll: 0,
    outstandingFromInvoices: unpaid.reduce((s, i) => s + i.amount, 0),
    invoices: [],
    unpaidInvoiceCount: unpaid.length,
    unpaidInvoices: unpaid,
    total: 0,
    ...overrides,
  };
}

const noReminders: ReminderLog = new Map();

describe("selectReminderCandidates", () => {
  describe("the 14-day threshold", () => {
    it("does not select an invoice one day too young", () => {
      const p = player({
        unpaidInvoices: [{ amount: 30, date: daysAgo(REMINDER_AFTER_DAYS - 1) }],
      });
      expect(selectReminderCandidates([p], noReminders, NOW)).toEqual([]);
    });

    it("selects an invoice exactly at the threshold", () => {
      const p = player({
        unpaidInvoices: [{ amount: 30, date: daysAgo(REMINDER_AFTER_DAYS) }],
      });
      const got = selectReminderCandidates([p], noReminders, NOW);
      expect(got).toHaveLength(1);
      expect(got[0]!.name).toBe("Alice Martin");
      expect(got[0]!.daysOverdue).toBe(REMINDER_AFTER_DAYS);
    });

    it("selects a clearly overdue invoice", () => {
      const p = player({ unpaidInvoices: [{ amount: 30, date: daysAgo(30) }] });
      const got = selectReminderCandidates([p], noReminders, NOW);
      expect(got).toHaveLength(1);
      expect(got[0]!.daysOverdue).toBe(30);
      expect(got[0]!.oldestUnpaidDate).toBe(daysAgo(30));
    });
  });

  describe("the 7-day cooldown", () => {
    it("excludes a member reminded 3 days ago", () => {
      const p = player({ unpaidInvoices: [{ amount: 30, date: daysAgo(30) }] });
      const log: ReminderLog = new Map([["Alice Martin", NOW - 3 * DAY]]);
      expect(selectReminderCandidates([p], log, NOW)).toEqual([]);
    });

    it("re-includes a member reminded longer ago than the cooldown", () => {
      const p = player({ unpaidInvoices: [{ amount: 30, date: daysAgo(30) }] });
      const log: ReminderLog = new Map([
        ["Alice Martin", NOW - (REMINDER_COOLDOWN_DAYS + 1) * DAY],
      ]);
      expect(selectReminderCandidates([p], log, NOW)).toHaveLength(1);
    });

    it("does not confuse one member's cooldown with another's", () => {
      const alice = player({ name: "Alice Martin", unpaidInvoices: [{ amount: 30, date: daysAgo(30) }] });
      const bob = player({ name: "Bob Durand", unpaidInvoices: [{ amount: 20, date: daysAgo(30) }] });
      const log: ReminderLog = new Map([["Alice Martin", NOW - DAY]]);
      const got = selectReminderCandidates([alice, bob], log, NOW);
      expect(got.map((c) => c.name)).toEqual(["Bob Durand"]);
    });
  });

  describe("who is out of scope", () => {
    it("excludes a member with no unpaid invoices", () => {
      const p = player({ unpaidInvoices: [] });
      expect(selectReminderCandidates([p], noReminders, NOW)).toEqual([]);
    });

    it("excludes a member who owes money but was never invoiced", () => {
      // Purchases made after the last recap. They've had no bill, so chasing
      // them would be unfair.
      const p = player({ unpaidInvoices: [], total: 45, purchasesTotal: 45 });
      expect(selectReminderCandidates([p], noReminders, NOW)).toEqual([]);
    });

    it("excludes a member whose outstanding rounds to zero", () => {
      const p = player({
        unpaidInvoices: [{ amount: 0.001, date: daysAgo(30) }],
        outstandingFromInvoices: 0.001,
      });
      expect(selectReminderCandidates([p], noReminders, NOW)).toEqual([]);
    });

    it("skips an invoice whose date cannot be parsed rather than treating it as ancient", () => {
      // Over-billing is the safe error in debts.ts; over-nagging is not.
      const p = player({ unpaidInvoices: [{ amount: 30, date: "pas une date" }] });
      expect(selectReminderCandidates([p], noReminders, NOW)).toEqual([]);
    });

    it("still selects when a bad date sits alongside a good overdue one", () => {
      const p = player({
        unpaidInvoices: [
          { amount: 10, date: "???" },
          { amount: 20, date: daysAgo(20) },
        ],
      });
      const got = selectReminderCandidates([p], noReminders, NOW);
      expect(got).toHaveLength(1);
      expect(got[0]!.oldestUnpaidDate).toBe(daysAgo(20));
    });
  });

  describe("reporting", () => {
    it("reports the OLDEST unpaid invoice, not the newest", () => {
      const p = player({
        unpaidInvoices: [
          { amount: 10, date: daysAgo(20) },
          { amount: 20, date: daysAgo(60) },
        ],
      });
      const got = selectReminderCandidates([p], noReminders, NOW);
      expect(got[0]!.oldestUnpaidDate).toBe(daysAgo(60));
      expect(got[0]!.daysOverdue).toBe(60);
    });

    it("sums the outstanding amount", () => {
      const p = player({
        unpaidInvoices: [
          { amount: 10, date: daysAgo(20) },
          { amount: 20, date: daysAgo(60) },
        ],
      });
      expect(selectReminderCandidates([p], noReminders, NOW)[0]!.outstanding).toBeCloseTo(30);
    });

    it("orders longest-overdue first", () => {
      const a = player({ name: "A", unpaidInvoices: [{ amount: 5, date: daysAgo(20) }] });
      const b = player({ name: "B", unpaidInvoices: [{ amount: 5, date: daysAgo(90) }] });
      const c = player({ name: "C", unpaidInvoices: [{ amount: 5, date: daysAgo(45) }] });
      const got = selectReminderCandidates([a, b, c], noReminders, NOW);
      expect(got.map((x) => x.name)).toEqual(["B", "C", "A"]);
    });

    it("carries the e-mail through, and tolerates its absence", () => {
      const withEmail = player({ name: "A", unpaidInvoices: [{ amount: 5, date: daysAgo(20) }] });
      const without = player({
        name: "B",
        email: undefined,
        unpaidInvoices: [{ amount: 5, date: daysAgo(20) }],
      });
      const got = selectReminderCandidates([withEmail, without], noReminders, NOW);
      expect(got.find((c) => c.name === "A")!.email).toBe("alice@example.com");
      expect(got.find((c) => c.name === "B")!.email).toBeUndefined();
    });
  });

  it("returns an empty list for an empty roster", () => {
    expect(selectReminderCandidates([], noReminders, NOW)).toEqual([]);
  });
});
