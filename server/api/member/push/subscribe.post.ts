import { createError, readBody } from "h3";
import { d1Execute } from "#server/utils/d1";
import { requireMember } from "#server/utils/require-member";

// Register (or refresh) this browser's push subscription.
//
// The subscription is always stored against the *session's* player, never a
// name from the request body — otherwise any member could subscribe themselves
// to someone else's reminders, or worse, redirect them.

interface SubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export default defineEventHandler(async (event) => {
  const member = await requireMember(event);

  const body = (await readBody<SubscribeBody>(event)) ?? {};
  const endpoint = String(body.endpoint ?? "").trim();
  const p256dh = String(body.keys?.p256dh ?? "").trim();
  const auth = String(body.keys?.auth ?? "").trim();

  if (!endpoint || !p256dh || !auth) {
    throw createError({ statusCode: 400, statusMessage: "Subscription incomplète" });
  }

  // One row per player on the account. A parent registering themselves and
  // their children under one address subscribes for all of them at once —
  // otherwise a reminder aimed at the child would have no device to reach.
  //
  // Upsert on (player_name, endpoint): re-subscribing the same browser happens
  // on every permission re-grant and after some browser updates, and must
  // refresh rather than duplicate.
  const now = Date.now();
  for (const player of member.players) {
    await d1Execute(
      event,
      `INSERT INTO push_subscriptions
         (player_name, email, endpoint, p256dh, auth, created_at, failure_count)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(player_name, endpoint) DO UPDATE SET
         email         = excluded.email,
         p256dh        = excluded.p256dh,
         auth          = excluded.auth,
         failure_count = 0`,
      [player.name, member.email, endpoint, p256dh, auth, now],
    );
  }

  return { ok: true as const, players: member.names };
});
