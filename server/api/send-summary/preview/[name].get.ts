import { createError, getRouterParam } from "h3";
import { loadAllBalances } from "#server/utils/load-debts";
import { renderRecapEmail } from "#server/utils/email-template";
import { requireAdmin } from "#server/utils/require-admin";

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const rawName = getRouterParam(event, "name");
  if (!rawName) throw createError({ statusCode: 400, statusMessage: "Missing player name" });
  const name = decodeURIComponent(rawName);

  const { balances, cutoffDate } = await loadAllBalances(event);
  const player = balances.find((p) => p.name === name);
  if (!player) throw createError({ statusCode: 404, statusMessage: `Unknown player: ${name}` });

  const cutoffLabel = cutoffDate
    ? `${String(cutoffDate.getDate()).padStart(2, "0")}/${String(cutoffDate.getMonth() + 1).padStart(2, "0")}/${cutoffDate.getFullYear()}`
    : null;

  const { publicSiteUrl } = useRuntimeConfig(event);
  const html = renderRecapEmail(player, { cutoffDateLabel: cutoffLabel, publicSiteUrl: publicSiteUrl as string });

  return {
    name: player.name,
    email: player.email ?? null,
    total: player.total,
    html,
  };
});
