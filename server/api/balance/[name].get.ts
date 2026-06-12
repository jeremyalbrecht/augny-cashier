import { createError, getRouterParam } from "h3";
import { loadAllBalances } from "#server/utils/load-debts";

// Lean balance endpoint for the cashier UI. Gated by the global X-Token
// middleware (not requireAdmin) so it's reachable from the gym tablet
// without Google OAuth. Returns only the total + cutoff — no line items,
// tournaments, or payment history (those are admin-only via /api/debts).
export default defineEventHandler(async (event) => {
  const rawName = getRouterParam(event, "name");
  if (!rawName) {
    throw createError({ statusCode: 400, statusMessage: "Missing player name" });
  }
  const name = decodeURIComponent(rawName);

  const { balances, cutoffDate } = await loadAllBalances(event);
  const player = balances.find((p) => p.name === name);
  if (!player) {
    throw createError({ statusCode: 404, statusMessage: `Unknown player: ${name}` });
  }

  return {
    name: player.name,
    total: player.total,
    cutoffDate: cutoffDate ? cutoffDate.toISOString().slice(0, 10) : null,
  };
});
