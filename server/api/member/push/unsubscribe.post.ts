import { readBody } from "h3";
import { fsDeleteWhere } from "#server/utils/firestore";
import { requireMember } from "#server/utils/require-member";

interface UnsubscribeBody {
  endpoint?: string;
}

export default defineEventHandler(async (event) => {
  const member = await requireMember(event);

  const endpoint = String(((await readBody<UnsubscribeBody>(event)) ?? {}).endpoint ?? "").trim();
  if (!endpoint) return { ok: true as const };

  // Removes the device for every player on the account — the toggle is
  // per-device, not per-child, so switching it off must not leave a child still
  // pushing to a phone whose owner just opted out.
  //
  // Still scoped to the caller's own players, so a leaked endpoint string can't
  // be used to silence someone else's reminders.
  await fsDeleteWhere(event, "push_subscriptions", [
    { field: "endpoint", op: "EQUAL", value: endpoint },
    { field: "player_name", op: "IN", value: member.names },
  ]);

  return { ok: true as const };
});
