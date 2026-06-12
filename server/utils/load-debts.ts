import type { H3Event } from "h3";
import { google } from "googleapis";
import { getSheetData } from "#server/utils/fetch";
import {
  computeBalances,
  parseSheetDate,
  type DetteRow,
  type EnvoiRow,
  type JoueurRow,
  type PaiementRow,
  type PlayerBalance,
  type TarifRow,
  type TournoiOffertRow,
  type TournoiRow,
} from "#server/utils/debts";

async function fetchPaiements(spreadsheetId: string, sa: string): Promise<PaiementRow[]> {
  try {
    return (await getSheetData({
      spreadsheetId,
      range: "Paiements!A1:E1000",
      credentialsRaw: sa,
    })) as PaiementRow[];
  } catch {
    // Sheet may not exist yet — treat as empty so the endpoint stays usable
    // while the spreadsheet is being set up.
    return [];
  }
}

async function fetchEnvois(spreadsheetId: string, sa: string): Promise<EnvoiRow[]> {
  try {
    return (await getSheetData({
      spreadsheetId,
      range: "Envois!A1:D1000",
      credentialsRaw: sa,
    })) as EnvoiRow[];
  } catch {
    // Same graceful fallback — Envois may not exist until the first recap send.
    return [];
  }
}

/**
 * Reads the cutoff date from the Data sheet. We search column A for a label
 * containing "dernier envoi" (case-insensitive) and read the date next to it,
 * rather than hardcoding B1 — so rows can be rearranged without breaking this.
 * Returns null if the sheet/label/date is missing or unparseable.
 */
async function fetchCutoffDate(spreadsheetId: string, sa: string): Promise<Date | null> {
  try {
    const credentials = JSON.parse(atob(sa));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Data!A1:B20",
    });
    const rows = res.data.values ?? [];
    for (const row of rows) {
      const label = String(row[0] ?? "").toLowerCase();
      if (label.includes("dernier envoi")) {
        return parseSheetDate(row[1]);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export interface LoadedBalances {
  balances: PlayerBalance[];
  cutoffDate: Date | null;
}

export async function loadAllBalances(event: H3Event): Promise<LoadedBalances> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || "";
  const { sa } = useRuntimeConfig(event);

  const [joueurs, tarifs, dettes, tournois, tournoisOfferts, paiements, envois, cutoffDate] = await Promise.all([
    getSheetData({ spreadsheetId, range: "Joueurs!A1:Z1000", credentialsRaw: sa }) as Promise<JoueurRow[]>,
    getSheetData({ spreadsheetId, range: "Tarifs!A1:C200", credentialsRaw: sa }) as Promise<TarifRow[]>,
    getSheetData({ spreadsheetId, range: "Dettes!A1:D5000", credentialsRaw: sa }) as Promise<DetteRow[]>,
    getSheetData({ spreadsheetId, range: "'Tournois N'!A1:Z2000", credentialsRaw: sa }) as Promise<TournoiRow[]>,
    getSheetData({ spreadsheetId, range: "'Tournois offerts'!A1:A200", credentialsRaw: sa }) as Promise<TournoiOffertRow[]>,
    fetchPaiements(spreadsheetId, sa),
    fetchEnvois(spreadsheetId, sa),
    fetchCutoffDate(spreadsheetId, sa),
  ]);

  const balances = computeBalances({
    joueurs, tarifs, dettes, tournois, tournoisOfferts, paiements, envois, cutoffDate,
  });

  return { balances, cutoffDate };
}
