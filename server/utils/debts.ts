// Debt computation for Augny Badminton.
//
// Pure functions over rows fetched from the "Dettes adhérents 25/26" Google
// Sheet. No I/O — call sites pass in already-fetched rows so this module is
// trivial to unit-test and reason about.
//
// Business rules (ported from the legacy Python `debt-csjbad`):
//   - Purchases in the `Dettes` sheet sum naturally (negative prices = refunds).
//   - Tournaments: due = `Montant dû` − `Paiement joueur`.
//   - Tournament whose name contains an entry of `Tournois offerts` is free.
//   - "Every-5th-tournament-free" discount: tournaments at positions 1, 5, 10,
//     15, 20… (1-indexed) are offered by the club. Order is the order returned
//     by the sheet, which is chronological in practice.
//   - Payments in the `Paiements` sheet reduce the balance.

export interface JoueurRow {
  Nom: string;
  Email?: string;
  Licence?: string | number;
  [k: string]: unknown;
}

export interface TarifRow {
  Item: string;
  Catégorie?: string;
  Prix?: string;
}

export interface DetteRow {
  Nom: string;
  Item: string;
  Prix: string;
  Date: string;
}

export interface TournoiRow {
  Licence: string | number;
  Tournoi: string;
  Date: string;
  Lieu?: string;
  Vainqueur?: string | number;
  Finaliste?: string | number;
  "Montant dû": string | number;
  "Paiement joueur": string | number;
}

export interface TournoiOffertRow {
  Tournoi: string;
}

export interface PaiementRow {
  Nom: string;
  Montant: string;
  Date: string;
  Méthode?: string;
  Note?: string;
}

export interface EnvoiRow {
  Nom: string;
  Montant: string;
  Date: string;
  Note?: string;
}

export interface DebtLine {
  item: string;
  category: string;
  price: number;
  date: string;
}

export interface TournamentLine {
  name: string;
  date: string;
  place?: string;
  due: number;
  originalDue: number;
  /** Amount the player already paid directly (Tournois N column "Paiement joueur").
   *  Email template hides any line where this is > 0 — Python parity, treats those
   *  as already-settled offline. */
  paiementJoueur: number;
  offered: boolean;
  offeredReason?: "every-5th" | "in-offered-list";
  win: boolean;
  finalist: boolean;
  /** True when `date` couldn't be matched by parseSheetDate. The row is still
   *  billed (safer to over-charge than to silently drop one), but the UI
   *  flags it so the cutoff filter can't be applied to it correctly. */
  dateUnparseable?: boolean;
}

export interface PaymentLine {
  amount: number;
  date: string;
  method?: string;
  note?: string;
}

export interface InvoiceLine {
  amount: number;
  date: string;
  note?: string;
}

export interface PlayerBalance {
  name: string;
  email?: string;
  licence?: string;
  // --- Current-period view (cutoff-filtered) — line breakdown for the UI ---
  purchasesTotal: number;
  tournamentsTotal: number;
  paymentsTotal: number;
  lines: DebtLine[];
  tournaments: TournamentLine[];
  payments: PaymentLine[];
  // --- Invoice tracking (unfiltered) — drives "Non payés" + total Solde ---
  /** Total of all Envois rows for this player (every recap ever sent). */
  invoicesTotal: number;
  /** Total of ALL Paiements rows for this player, regardless of cutoff. */
  paymentsTotalAll: number;
  /** max(invoicesTotal − paymentsTotalAll, 0). Running tally — payments
   *  naturally settle the oldest unpaid invoices first. */
  outstandingFromInvoices: number;
  /** Per-invoice history for the detail panel. */
  invoices: InvoiceLine[];
  /** Number of invoices not fully covered by paymentsTotalAll, walked FIFO
   *  in chronological order. A partially-covered invoice counts as unpaid. */
  unpaidInvoiceCount: number;
  /** The actual unpaid (or partially-paid) invoices, FIFO. Partial entries
   *  carry the remaining unpaid amount, not the original invoice amount. */
  unpaidInvoices: InvoiceLine[];
  /**
   * Full Solde: prior-period outstanding from Envois + current-period charges.
   *   total = purchasesTotal + tournamentsTotal + invoicesTotal − paymentsTotalAll
   * Negative values are real (player has paid more than billed/owed = credit).
   * This is the number drivers (UI badge, "Total dû", recap-email "Total dû") read.
   */
  total: number;
}

const FRENCH_MONTHS: Record<string, number> = {
  janvier: 0, fevrier: 1, "février": 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, "août": 7, septembre: 8, octobre: 9, novembre: 10, "décembre": 11, decembre: 11,
};

/**
 * Parses dates in the formats the spreadsheet uses:
 *  - "DD/MM/YYYY" (Dettes, Paiements, Data cutoff)
 *  - "YYYY-MM-DD" (ISO, also accepted in Data cutoff)
 *  - French verbose forms used in Tournois N: "Le 21 août 2025",
 *    "Les 21 et 22 août 2025", "Du 21 au 22 août 2025".
 *
 * Returns null when the string can't be recognized; callers decide whether to
 * drop or keep rows with unparseable dates.
 */
export function parseSheetDate(raw: unknown): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const [, y, m, d] = iso;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  // French verbose: keep only the FIRST day if it's a range, since the
  // tournament conceptually starts then.
  const french = /(?:Les|Le|Du)\s+(\d{1,2})\s+(?:(?:au|et)\s+\d{1,2}\s+)?([A-Za-zÀ-ÿ]+)\s*(\d{4})?/i
    .exec(s);
  if (french) {
    const dayStr = french[1];
    const monthStr = french[2];
    const yearStr = french[3];
    if (dayStr && monthStr) {
      const month = FRENCH_MONTHS[monthStr.toLowerCase()];
      if (month != null) {
        const year = yearStr ? Number(yearStr) : new Date().getFullYear();
        return new Date(year, month, Number(dayStr));
      }
    }
  }
  return null;
}

/**
 * Parse a French-formatted euro amount: "23,50 €", "-23,50 €", "1 234,56 €".
 * Returns NaN for empty/unparseable input — callers should treat NaN as 0
 * unless they explicitly want to flag malformed rows.
 */
export function parseEuro(raw: unknown): number {
  if (raw == null) return NaN;
  const s = String(raw)
    .replace(/ /g, "") // non-breaking spaces sometimes show up from Sheets
    .replace(/\s/g, "")
    .replace(/€/g, "")
    .replace(",", ".");
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeLicence(raw: unknown): string | undefined {
  if (raw == null || raw === "") return undefined;
  return String(raw).trim();
}

function computeTournamentDue(
  rawDue: unknown,
  rawPayment: unknown,
  name: string,
  tournoisOfferts: string[],
): { due: number; originalDue: number; offered: boolean; reason?: TournamentLine["offeredReason"] } {
  const due = (Number(rawDue) || 0) - (Number(rawPayment) || 0);
  const originalDue = due;

  if (tournoisOfferts.some((t) => t && name.includes(t))) {
    return { due: 0, originalDue, offered: true, reason: "in-offered-list" };
  }
  return { due, originalDue, offered: false };
}

/**
 * Tournaments at positions 1, 5, 10, 15, 20… (1-indexed) are offered.
 * Matches the Python `discount_tournaments` rule exactly.
 */
function applyEveryFifthDiscount(tournaments: TournamentLine[]): void {
  tournaments.forEach((t, i) => {
    if (t.offered) return; // already free for another reason
    if (i === 0 || (i + 1) % 5 === 0) {
      t.due = 0;
      t.offered = true;
      t.offeredReason = "every-5th";
    }
  });
}

export interface ComputeBalancesInput {
  joueurs: JoueurRow[];
  tarifs: TarifRow[];
  dettes: DetteRow[];
  tournois: TournoiRow[];
  tournoisOfferts: TournoiOffertRow[];
  paiements: PaiementRow[];
  envois?: EnvoiRow[];
  /** Only rows with date >= cutoff are included. Tournament rows with
   *  unparseable dates are kept (safer to over-bill than to silently drop). */
  cutoffDate?: Date | null;
}

function afterCutoff(rawDate: unknown, cutoff: Date | null | undefined, defaultIfUnparseable: boolean): boolean {
  if (!cutoff) return true;
  const parsed = parseSheetDate(rawDate);
  if (!parsed) return defaultIfUnparseable;
  return parsed.getTime() >= cutoff.getTime();
}

function isDateUnparseable(rawDate: unknown): boolean {
  if (rawDate == null || String(rawDate).trim() === "") return false; // empty ≠ malformed
  return parseSheetDate(rawDate) == null;
}

export function computeBalances(input: ComputeBalancesInput): PlayerBalance[] {
  const { joueurs, tarifs, dettes, tournois, tournoisOfferts, paiements, envois = [], cutoffDate } = input;

  const categoryByItem = new Map<string, string>();
  for (const t of tarifs) {
    if (t.Item) categoryByItem.set(t.Item, t.Catégorie ?? "Divers");
  }

  const offered = tournoisOfferts.map((t) => t.Tournoi).filter(Boolean);

  const players = new Map<string, PlayerBalance>();
  const byLicence = new Map<string, PlayerBalance>();
  for (const j of joueurs) {
    if (!j.Nom) continue;
    const p: PlayerBalance = {
      name: j.Nom,
      email: j.Email,
      licence: normalizeLicence(j.Licence),
      purchasesTotal: 0,
      tournamentsTotal: 0,
      paymentsTotal: 0,
      total: 0,
      lines: [],
      tournaments: [],
      payments: [],
      invoicesTotal: 0,
      paymentsTotalAll: 0,
      outstandingFromInvoices: 0,
      invoices: [],
      unpaidInvoiceCount: 0,
      unpaidInvoices: [],
    };
    players.set(j.Nom, p);
    if (p.licence) byLicence.set(p.licence, p);
  }

  for (const row of dettes) {
    const p = players.get(row.Nom);
    if (!p) continue; // debt row for an unknown player — skip silently for now
    if (!afterCutoff(row.Date, cutoffDate, false)) continue;
    const price = parseEuro(row.Prix);
    if (Number.isNaN(price)) continue;
    p.lines.push({
      item: row.Item,
      category: categoryByItem.get(row.Item) ?? "Divers",
      price,
      date: row.Date,
    });
    p.purchasesTotal += price;
  }

  for (const row of tournois) {
    const licence = normalizeLicence(row.Licence);
    if (!licence) continue;
    const p = byLicence.get(licence);
    if (!p) continue;
    // Load ALL tournaments here (no cutoff filter). The every-5th-free rule
    // counts positions across the full season — filtering before would shift
    // the indices and wrongly mark a non-free tournament as offered. The
    // cutoff filter is applied below after applyEveryFifthDiscount.
    const { due, originalDue, offered: isOffered, reason } = computeTournamentDue(
      row["Montant dû"],
      row["Paiement joueur"],
      row.Tournoi,
      offered,
    );
    p.tournaments.push({
      name: row.Tournoi,
      date: row.Date,
      place: row.Lieu,
      due,
      originalDue,
      paiementJoueur: Number(row["Paiement joueur"]) || 0,
      offered: isOffered,
      offeredReason: reason,
      win: Number(row.Vainqueur) === 1,
      finalist: Number(row.Finaliste) === 1,
      dateUnparseable: isDateUnparseable(row.Date),
    });
  }

  for (const row of paiements) {
    const p = players.get(row.Nom);
    if (!p) continue;
    const amount = parseEuro(row.Montant);
    if (Number.isNaN(amount)) continue;
    // Unfiltered total — drives the running tally against Envois.
    p.paymentsTotalAll += amount;
    // Cutoff-filtered list + total — drives the current-period "Total dû".
    if (!afterCutoff(row.Date, cutoffDate, false)) continue;
    p.payments.push({
      amount,
      date: row.Date,
      method: row.Méthode,
      note: row.Note,
    });
    p.paymentsTotal += amount;
  }

  for (const row of envois) {
    const p = players.get(row.Nom);
    if (!p) continue;
    const amount = parseEuro(row.Montant);
    if (Number.isNaN(amount)) continue;
    p.invoices.push({ amount, date: row.Date, note: row.Note });
    p.invoicesTotal += amount;
  }

  for (const p of players.values()) {
    applyEveryFifthDiscount(p.tournaments);
    // Drop pre-cutoff tournaments AFTER the discount has been assigned, so the
    // free slot stays "claimed" by the correct tournament in the full season.
    if (cutoffDate) {
      p.tournaments = p.tournaments.filter((t) => afterCutoff(t.date, cutoffDate, true));
    }
    p.tournamentsTotal = p.tournaments.reduce((s, t) => s + t.due, 0);
    // Solde = prior outstanding (invoices − payments, can go negative for credit)
    //         + current-period charges. Equivalent to: everything billed/owed
    //         all-time − everything paid all-time.
    p.total = p.purchasesTotal + p.tournamentsTotal + p.invoicesTotal - p.paymentsTotalAll;
    p.outstandingFromInvoices = Math.max(p.invoicesTotal - p.paymentsTotalAll, 0);

    // FIFO walk: count invoices not fully covered by total payments. Sort
    // chronologically since sheet order isn't guaranteed; unparseable dates
    // fall back to insertion order.
    const sortedInvoices = [...p.invoices].sort((a, b) => {
      const da = parseSheetDate(a.date)?.getTime() ?? 0;
      const db = parseSheetDate(b.date)?.getTime() ?? 0;
      return da - db;
    });
    let remaining = p.paymentsTotalAll;
    let unpaid = 0;
    const unpaidInvoices: InvoiceLine[] = [];
    for (const inv of sortedInvoices) {
      if (remaining >= inv.amount) {
        remaining -= inv.amount;
      } else {
        unpaid++;
        // For a partially-covered invoice, surface only the unpaid portion so
        // the recap-email line reflects "what's still owed on this invoice".
        unpaidInvoices.push({
          amount: inv.amount - remaining,
          date: inv.date,
          note: inv.note,
        });
        remaining = 0;
      }
    }
    p.unpaidInvoiceCount = unpaid;
    p.unpaidInvoices = unpaidInvoices;
  }

  return Array.from(players.values()).sort((a, b) => b.total - a.total);
}

export function findPlayerBalance(balances: PlayerBalance[], name: string): PlayerBalance | undefined {
  return balances.find((p) => p.name === name);
}
