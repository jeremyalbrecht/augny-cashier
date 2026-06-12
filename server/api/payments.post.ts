import { createError, readBody } from "h3";
import { google } from "googleapis";
import { requireAdmin } from "#server/utils/require-admin";

interface PaymentBody {
  nom?: string;
  montant?: number | string;
  date?: string;
  methode?: string;
  note?: string;
}

function formatEuro(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

function todayFR(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  const body = (await readBody<PaymentBody>(event)) ?? {};

  if (!body.nom || body.montant == null) {
    throw createError({ statusCode: 400, statusMessage: "nom and montant are required" });
  }

  const amount = Number(body.montant);
  if (!Number.isFinite(amount) || amount === 0) {
    throw createError({ statusCode: 400, statusMessage: "montant must be a non-zero number" });
  }

  const { sa } = useRuntimeConfig(event);
  const credentials = JSON.parse(atob(sa));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || "";

  const row = [
    body.nom,
    formatEuro(amount),
    body.date || todayFR(),
    body.methode || "",
    body.note || "",
  ];

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Paiements!A2:E2",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  return { ok: true, row, updatedRange: response.data.updates?.updatedRange };
});
