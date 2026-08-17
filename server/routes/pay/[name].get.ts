import { createError, getRequestHost, getRequestProtocol, getRouterParam, sendRedirect } from "h3";
import { loadAllBalances } from "#server/utils/load-debts";
import { createCheckoutIntent } from "#server/utils/helloasso";

// Public payment entry point — deliberately outside /api so the shared
// X-Token middleware (server/middleware/auth.ts) doesn't gate it, since it's
// meant to be clicked from a member's own recap email with no token at all.
//
// A HelloAsso checkout-intent's redirectUrl is only valid for 15 minutes, so
// it can't be embedded directly in an email. This route is the stable URL:
// it mints a fresh intent on every click and 302s straight to it.
export default defineEventHandler(async (event) => {
  const rawName = getRouterParam(event, "name");
  if (!rawName) {
    throw createError({ statusCode: 400, statusMessage: "Missing player name" });
  }
  const name = decodeURIComponent(rawName);

  const { balances } = await loadAllBalances(event);
  const player = balances.find((p) => p.name === name);
  if (!player) {
    throw createError({ statusCode: 404, statusMessage: `Unknown player: ${name}` });
  }
  if (player.total <= 0) {
    return sendRedirect(event, "/", 302);
  }

  const { publicSiteUrl } = useRuntimeConfig(event);
  const origin = (publicSiteUrl as string) || `${getRequestProtocol(event)}://${getRequestHost(event)}`;

  try {
    const intent = await createCheckoutIntent(event, {
      amountCents: Math.round(player.total * 100),
      itemName: `Cotisation Augny Badminton - ${player.name}`,
      backUrl: `${origin}/`,
      errorUrl: `${origin}/`,
      returnUrl: `${origin}/`,
    });
    return sendRedirect(event, intent.redirectUrl, 302);
  } catch (e) {
    console.error("HelloAsso checkout-intent creation failed:", e);
    return sendRedirect(event, "/?payerror=1", 302);
  }
});
