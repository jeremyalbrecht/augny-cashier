import { createError, readBody } from "h3";
import { google } from "googleapis";
import { loadAllBalances } from "#server/utils/load-debts";
import { renderRecapEmail } from "#server/utils/email-template";
import { sendHtmlEmail } from "#server/utils/mailer";
import { requireAdmin } from "#server/utils/require-admin";
import { sendPushToPlayers } from "#server/utils/push";

interface SendSummaryBody {
  names?: string[];
}

interface PerPlayerResult {
  name: string;
  email: string | null;
  status: "sent" | "skipped" | "error";
  reason?: string;
}

function todayFR(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function cutoffLabel(d: Date | null): string | null {
  if (!d) return null;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function getSheetsClient(sa: string) {
  const credentials = JSON.parse(atob(sa));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function formatEuro(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

interface EnvoiAppend {
  name: string;
  amount: number;
}

/**
 * Appends one row per sent recipient to the Envois sheet, recording the
 * invoice amount. Throws if the sheet doesn't exist — surfacing the missing
 * sheet is more useful than silent data loss.
 */
async function appendEnvois(spreadsheetId: string, sa: string, today: string, items: EnvoiAppend[]): Promise<void> {
  if (items.length === 0) return;
  const sheets = getSheetsClient(sa);
  const values = items.map((i) => [i.name, formatEuro(i.amount), today, "Récap trimestriel"]);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Envois!A2:D2",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

/**
 * Advances the cutoff date in the Data sheet to today by writing the row whose
 * column A label contains "dernier envoi". Returns the new date string written,
 * or null if the label row couldn't be located.
 */
async function advanceCutoffDate(spreadsheetId: string, sa: string, todayStr: string): Promise<string | null> {
  const sheets = getSheetsClient(sa);

  const read = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Data!A1:B20",
  });
  const rows = read.data.values ?? [];
  let rowNumber: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    const label = String(rows[i]?.[0] ?? "").toLowerCase();
    if (label.includes("dernier envoi")) {
      rowNumber = i + 1; // 1-indexed for A1 notation
      break;
    }
  }
  if (rowNumber == null) return null;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Data!B${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[todayStr]] },
  });
  return todayStr;
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event);

  const body = (await readBody<SendSummaryBody>(event)) ?? {};
  const names = body.names ?? [];
  if (!Array.isArray(names) || names.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "names[] required" });
  }

  const { smtp, sa } = useRuntimeConfig(event);
  if (!smtp?.user || !smtp?.password) {
    throw createError({
      statusCode: 500,
      statusMessage: "SMTP not configured (set NUXT_SMTP_USER and NUXT_SMTP_PASSWORD)",
    });
  }
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || "";

  const { balances, cutoffDate } = await loadAllBalances(event);
  const cutoffStr = cutoffLabel(cutoffDate);
  const byName = new Map(balances.map((p) => [p.name, p]));

  const results: PerPlayerResult[] = [];
  const envoisToAppend: EnvoiAppend[] = [];
  let sentCount = 0;

  for (const name of names) {
    const player = byName.get(name);
    if (!player) {
      results.push({ name, email: null, status: "error", reason: "Unknown player" });
      continue;
    }
    if (!player.email) {
      results.push({ name, email: null, status: "skipped", reason: "No email on file" });
      continue;
    }
    if (player.total <= 0.005) {
      results.push({ name, email: player.email, status: "skipped", reason: "Nothing owed" });
      continue;
    }
    const html = renderRecapEmail(player, { cutoffDateLabel: cutoffStr });
    try {
      await sendHtmlEmail(
        { user: smtp.user as string, password: smtp.password as string },
        player.email,
        "Récap de tes dettes — Augny Badminton",
        html,
      );
      results.push({ name, email: player.email, status: "sent" });
      // Record ONLY the new-period charges in Envois — prior outstanding is
      // already represented by previous Envois rows. Writing the full Solde
      // here would double-count past invoices in `outstandingFromInvoices`.
      const newCharges = player.purchasesTotal + player.tournamentsTotal;
      if (newCharges > 0.005) {
        envoisToAppend.push({ name: player.name, amount: newCharges });
      }
      sentCount++;
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Unknown error";
      results.push({ name, email: player.email, status: "error", reason });
    }
  }

  const todayStr = todayFR();

  // Record each successful invoice in the Envois sheet. We do this BEFORE
  // advancing the cutoff so an Envois-write failure is loud and recoverable.
  let envoisError: string | null = null;
  if (envoisToAppend.length > 0) {
    try {
      await appendEnvois(spreadsheetId, sa, todayStr, envoisToAppend);
    } catch (e) {
      envoisError = e instanceof Error ? e.message : "Unknown error";
      console.error("Failed to append Envois (sheet missing?):", e);
    }
  }

  // Advance the cutoff only if at least one email went out — otherwise a
  // fully-failed batch would silently lose the previous cutoff anchor.
  let newCutoff: string | null = null;
  if (sentCount > 0) {
    try {
      newCutoff = await advanceCutoffDate(spreadsheetId, sa, todayStr);
    } catch (e) {
      console.error("Failed to advance cutoff:", e);
    }
  }

  // Fourth side effect: nudge the recipients on their phone. Purely additive —
  // the e-mail is the record, this is just a chance they'll actually read it.
  // Non-fatal, surfaced via pushError the same way envoisError is.
  let pushSentCount = 0;
  let pushError: string | null = null;
  const emailedNames = results.filter((r) => r.status === "sent").map((r) => r.name);
  if (emailedNames.length > 0) {
    try {
      const pushResult = await sendPushToPlayers(event, emailedNames, {
        title: "Dettes - Augny Badminton",
        body: "Ton récap de dettes vient d'être envoyé par e-mail. Ouvre ton espace adhérent ou tes emails pour le détail.",
        url: "/mon-compte",
        tag: "augny-recap",
      });
      pushSentCount = pushResult.sent;
    } catch (e) {
      pushError = e instanceof Error ? e.message : "Unknown error";
      console.error("Failed to send push notifications:", e);
    }
  }

  return {
    results,
    sentCount,
    skippedCount: results.filter((r) => r.status === "skipped").length,
    errorCount: results.filter((r) => r.status === "error").length,
    newCutoffDate: newCutoff,
    envoisError,
    pushSentCount,
    pushError,
  };
});
