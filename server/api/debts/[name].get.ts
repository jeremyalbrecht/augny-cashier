import { createError, getRouterParam } from "h3";
import { loadAllBalances } from "#server/utils/load-debts";
import { requireAdmin } from "#server/utils/require-admin";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
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
    data: player,
    cutoffDate: cutoffDate ? cutoffDate.toISOString().slice(0, 10) : null,
  };
});
