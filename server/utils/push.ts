import type { H3Event } from "h3";
import webpush from "web-push";
import { d1Query, d1Execute, isD1Configured } from "#server/utils/d1";

// Web push delivery.
//
// Reach, by platform — this matters because there is no e-mail fallback:
//   Android (Chrome/Firefox/Edge) and all desktop → works after a permission
//     prompt, no install needed. This is the primary path.
//   iOS/iPadOS Safari 16.4+ → only once the page is added to the Home Screen.
//   Chrome/Firefox on iOS → never; they're Safari underneath with no push API.
//
// So a member with no row in push_subscriptions receives NOTHING. Callers must
// surface `noSubscription` rather than reporting a clean success.

export interface PushPayload {
  title: string;
  body: string;
  /** Path opened when the notification is tapped. */
  url?: string;
  /** Collapse key — repeat reminders replace each other instead of stacking. */
  tag?: string;
}

export interface PushResult {
  sent: number;
  failed: number;
  /** Subscriptions deleted because the endpoint is permanently gone. */
  pruned: number;
  /** Players with no usable subscription — i.e. who were not reached at all. */
  noSubscription: string[];
}

interface SubscriptionRow {
  id: number;
  player_name: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function configureVapid(event: H3Event): boolean {
  const { vapid } = useRuntimeConfig(event);
  if (!vapid?.publicKey || !vapid?.privateKey) return false;
  webpush.setVapidDetails(
    (vapid.subject as string) || "mailto:contact@augny-badminton.fr",
    vapid.publicKey as string,
    vapid.privateKey as string,
  );
  return true;
}

/**
 * Sends a notification to every subscription belonging to the named players.
 *
 * Never throws: push is always a secondary side effect of some other action
 * (sending a recap, running reminders) and must not fail that action. Problems
 * come back in the result for the caller to surface.
 */
export async function sendPushToPlayers(
  event: H3Event,
  names: string[],
  payload: PushPayload,
): Promise<PushResult> {
  const empty: PushResult = { sent: 0, failed: 0, pruned: 0, noSubscription: [...names] };
  if (names.length === 0) return { ...empty, noSubscription: [] };
  if (!isD1Configured(event)) {
    console.warn("[push] D1 not configured — no notifications sent");
    return empty;
  }
  if (!configureVapid(event)) {
    console.warn("[push] VAPID keys not configured — no notifications sent");
    return empty;
  }

  let subs: SubscriptionRow[];
  try {
    const placeholders = names.map(() => "?").join(", ");
    subs = await d1Query<SubscriptionRow>(
      event,
      `SELECT id, player_name, endpoint, p256dh, auth
         FROM push_subscriptions
        WHERE player_name IN (${placeholders})`,
      names,
    );
  } catch (e) {
    console.error("[push] failed to load subscriptions:", e);
    return empty;
  }

  // One device can serve several players (a parent registered with their
  // children on one address), so the same endpoint may appear more than once.
  // Send to each device once, but credit every player it covers — otherwise a
  // household owing for two children gets buzzed twice for the same reminder.
  const byEndpoint = new Map<string, { sub: SubscriptionRow; players: string[] }>();
  for (const sub of subs) {
    const existing = byEndpoint.get(sub.endpoint);
    if (existing) existing.players.push(sub.player_name);
    else byEndpoint.set(sub.endpoint, { sub, players: [sub.player_name] });
  }

  const reached = new Set<string>();
  const result: PushResult = { sent: 0, failed: 0, pruned: 0, noSubscription: [] };
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/mon-compte",
    tag: payload.tag,
  });

  for (const { sub, players } of byEndpoint.values()) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
      );
      result.sent++;
      for (const name of players) reached.add(name);
      await d1Execute(
        event,
        "UPDATE push_subscriptions SET last_success_at = ? WHERE endpoint = ?",
        [Date.now(), sub.endpoint],
      ).catch(() => {});
    } catch (e: unknown) {
      const status = (e as { statusCode?: number })?.statusCode;
      // 404/410 mean the push service has permanently dropped this endpoint —
      // the member uninstalled the app or revoked permission. Delete every row
      // for that endpoint (it may serve several players); otherwise dead
      // endpoints accumulate forever and every future send wastes a request.
      if (status === 404 || status === 410) {
        result.pruned++;
        await d1Execute(event, "DELETE FROM push_subscriptions WHERE endpoint = ?", [
          sub.endpoint,
        ]).catch((err) => console.error("[push] failed to prune dead subscription:", err));
      } else {
        result.failed++;
        console.error(`[push] send failed for ${players.join(", ")} (status ${status}):`, e);
      }
    }
  }

  result.noSubscription = names.filter((n) => !reached.has(n));
  return result;
}

/** Player names that currently have at least one push subscription. Used by the
 *  admin UI to say honestly how many people a reminder will actually reach. */
export async function playersWithSubscriptions(
  event: H3Event,
  names: string[],
): Promise<Set<string>> {
  if (names.length === 0 || !isD1Configured(event)) return new Set();
  try {
    const placeholders = names.map(() => "?").join(", ");
    const rows = await d1Query<{ player_name: string }>(
      event,
      `SELECT DISTINCT player_name FROM push_subscriptions WHERE player_name IN (${placeholders})`,
      names,
    );
    return new Set(rows.map((r) => r.player_name));
  } catch (e) {
    console.error("[push] failed to check subscriptions:", e);
    return new Set();
  }
}
