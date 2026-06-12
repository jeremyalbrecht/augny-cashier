import { loadAllBalances } from "#server/utils/load-debts";
import { requireAdmin } from "#server/utils/require-admin";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const { balances, cutoffDate } = await loadAllBalances(event);

  const unparseable = balances.flatMap((p) =>
    p.tournaments
      .filter((t) => t.dateUnparseable)
      .map((t) => ({ player: p.name, tournament: t.name, rawDate: t.date })),
  );

  const unpaid = balances.filter((p) => p.outstandingFromInvoices > 0.01);

  return {
    data: balances,
    summary: {
      playerCount: balances.length,
      totalOwed: balances.reduce((s, p) => s + Math.max(p.total, 0), 0),
      unpaidCount: unpaid.length,
      totalUnpaid: unpaid.reduce((s, p) => s + p.outstandingFromInvoices, 0),
      cutoffDate: cutoffDate ? cutoffDate.toISOString().slice(0, 10) : null,
      unparseableTournamentDates: unparseable,
    },
  };
});
