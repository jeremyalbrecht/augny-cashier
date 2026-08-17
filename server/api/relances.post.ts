import { readBody } from "h3";
import { loadAllBalances } from "#server/utils/load-debts";
import { requireAdmin } from "#server/utils/require-admin";
import { d1Query, d1Execute, isD1Configured } from "#server/utils/d1";
import { sendPushToPlayers, playersWithSubscriptions } from "#server/utils/push";
import {
  selectReminderCandidates,
  REMINDER_COOLDOWN_DAYS,
  type ReminderLog,
} from "#server/utils/reminders";

// Payment reminders for members whose invoices have gone unpaid.
//
// Manual, not scheduled: the treasurer decides when to nag. `dryRun` powers the
// confirmation modal, so the same selection logic decides who is listed and who
// is actually notified — they can't drift apart.
//
// IMPORTANT: this is push-only. A candidate with no push subscription receives
// nothing at all, which is why the response separates `notified` from
// `noSubscription`. The UI must show both or it will overstate reach.

interface RelancesBody {
  dryRun?: boolean;
  /** Restrict to these names. Omitted = every eligible candidate. */
  names?: string[];
}

async function loadReminderLog(event: Parameters<typeof d1Query>[0]): Promise<ReminderLog> {
  const log: ReminderLog = new Map();
  if (!isD1Configured(event)) return log;
  try {
    const since = Date.now() - REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const rows = await d1Query<{ player_name: string; sent_at: number }>(
      event,
      "SELECT player_name, MAX(sent_at) AS sent_at FROM reminders_sent WHERE sent_at > ? GROUP BY player_name",
      [since],
    );
    for (const r of rows) log.set(r.player_name, r.sent_at);
  } catch (e) {
    // Without the log we'd re-notify everyone. Failing closed (empty log) would
    // spam members, so surface the error to the caller instead.
    console.error("[relances] failed to load reminder log:", e);
    throw new Error("Impossible de lire l'historique des relances");
  }
  return log;
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const body = (await readBody<RelancesBody>(event)) ?? {};
  const dryRun = body.dryRun === true;

  const { balances } = await loadAllBalances(event);
  const log = await loadReminderLog(event);

  let candidates = selectReminderCandidates(balances, log, Date.now());
  if (body.names?.length) {
    const wanted = new Set(body.names);
    candidates = candidates.filter((c) => wanted.has(c.name));
  }

  const names = candidates.map((c) => c.name);

  if (dryRun) {
    // Report reach honestly so the confirm dialog can warn about the members
    // who will silently receive nothing.
    const reachable = await playersWithSubscriptions(event, names);
    return {
      dryRun: true as const,
      candidates: candidates.map((c) => ({ ...c, hasPush: reachable.has(c.name) })),
      reachableCount: names.filter((n) => reachable.has(n)).length,
      unreachableCount: names.filter((n) => !reachable.has(n)).length,
    };
  }

  if (names.length === 0) {
    return { dryRun: false as const, sent: 0, failed: 0, pruned: 0, noSubscription: [], notified: [] };
  }

  const result = await sendPushToPlayers(event, names, {
    title: "Augny Badminton",
    body: "Tu as un récap de dettes en attente de règlement. Ouvre ton espace adhérent pour le détail.",
    url: "/mon-compte",
    tag: "augny-relance",
  });

  // Only log members we actually reached — someone who got nothing must stay
  // eligible for the next run rather than being silently cooled down for a
  // week on the strength of a notification that never arrived.
  const notified = names.filter((n) => !result.noSubscription.includes(n));
  if (notified.length > 0) {
    const now = Date.now();
    try {
      const values = notified.map(() => "(?, ?)").join(", ");
      const params = notified.flatMap((n) => [n, now]);
      await d1Execute(
        event,
        `INSERT INTO reminders_sent (player_name, sent_at) VALUES ${values}`,
        params,
      );
    } catch (e) {
      console.error("[relances] failed to record reminders:", e);
    }
  }

  return {
    dryRun: false as const,
    sent: result.sent,
    failed: result.failed,
    pruned: result.pruned,
    noSubscription: result.noSubscription,
    notified,
  };
});
