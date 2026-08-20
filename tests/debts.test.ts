import { describe, it, expect } from "vitest";
import {
  parseSheetDate,
  parseEuro,
  computeBalances,
  type JoueurRow,
  type TarifRow,
  type DetteRow,
  type TournoiRow,
  type TournoiOffertRow,
  type PaiementRow,
} from "../server/utils/debts";

// ---------------------------------------------------------------------------
// parseSheetDate — every format we've seen in the spreadsheet or reasonably
// expect operators to type.
// ---------------------------------------------------------------------------
describe("parseSheetDate", () => {
  describe("DD/MM/YYYY (the dominant format in Dettes & Paiements)", () => {
    it("parses zero-padded", () => {
      const d = parseSheetDate("21/08/2025");
      expect(d?.getFullYear()).toBe(2025);
      expect(d?.getMonth()).toBe(7); // August = 7
      expect(d?.getDate()).toBe(21);
    });
    it("parses single-digit day and month", () => {
      const d = parseSheetDate("1/3/2026");
      expect(d?.getFullYear()).toBe(2026);
      expect(d?.getMonth()).toBe(2);
      expect(d?.getDate()).toBe(1);
    });
    it("parses end-of-year dates", () => {
      const d = parseSheetDate("31/12/2025");
      expect(d?.getMonth()).toBe(11);
      expect(d?.getDate()).toBe(31);
    });
    it("trims surrounding whitespace", () => {
      expect(parseSheetDate("  21/08/2025  ")).not.toBeNull();
    });
  });

  describe("YYYY-MM-DD (ISO)", () => {
    it("parses ISO with dashes", () => {
      const d = parseSheetDate("2026-03-12");
      expect(d?.getFullYear()).toBe(2026);
      expect(d?.getMonth()).toBe(2);
      expect(d?.getDate()).toBe(12);
    });
    it("parses ISO with single-digit components", () => {
      const d = parseSheetDate("2026-3-5");
      expect(d?.getMonth()).toBe(2);
      expect(d?.getDate()).toBe(5);
    });
  });

  describe("French verbose (Tournois N column)", () => {
    it('parses "Le 21 août 2025"', () => {
      const d = parseSheetDate("Le 21 août 2025");
      expect(d?.getFullYear()).toBe(2025);
      expect(d?.getMonth()).toBe(7);
      expect(d?.getDate()).toBe(21);
    });
    it('parses "Les 21 et 22 août 2025" using the first day', () => {
      const d = parseSheetDate("Les 21 et 22 août 2025");
      expect(d?.getDate()).toBe(21);
      expect(d?.getMonth()).toBe(7);
    });
    it('parses "Du 21 au 22 août 2025" using the first day', () => {
      const d = parseSheetDate("Du 21 au 22 août 2025");
      expect(d?.getDate()).toBe(21);
    });
    it("uses current year when no year is given", () => {
      const d = parseSheetDate("Le 3 mars");
      expect(d?.getFullYear()).toBe(new Date().getFullYear());
      expect(d?.getMonth()).toBe(2);
      expect(d?.getDate()).toBe(3);
    });
    it("accepts month names without accents (aout, fevrier, decembre)", () => {
      expect(parseSheetDate("Le 1 aout 2025")?.getMonth()).toBe(7);
      expect(parseSheetDate("Le 1 fevrier 2025")?.getMonth()).toBe(1);
      expect(parseSheetDate("Le 1 decembre 2025")?.getMonth()).toBe(11);
    });
    it("accepts month names with accents (août, février, décembre)", () => {
      expect(parseSheetDate("Le 1 août 2025")?.getMonth()).toBe(7);
      expect(parseSheetDate("Le 1 février 2025")?.getMonth()).toBe(1);
      expect(parseSheetDate("Le 1 décembre 2025")?.getMonth()).toBe(11);
    });
    it("is case-insensitive on the leading word", () => {
      expect(parseSheetDate("le 1 mars 2025")).not.toBeNull();
      expect(parseSheetDate("LE 1 mars 2025")).not.toBeNull();
      expect(parseSheetDate("LES 1 et 2 mars 2025")).not.toBeNull();
    });
    it("covers all 12 French months", () => {
      const months: [string, number][] = [
        ["janvier", 0], ["février", 1], ["mars", 2], ["avril", 3], ["mai", 4],
        ["juin", 5], ["juillet", 6], ["août", 7], ["septembre", 8],
        ["octobre", 9], ["novembre", 10], ["décembre", 11],
      ];
      for (const [name, idx] of months) {
        expect(parseSheetDate(`Le 1 ${name} 2025`)?.getMonth()).toBe(idx);
      }
    });
  });

  describe("invalid / empty inputs", () => {
    it("returns null for null/undefined/empty", () => {
      expect(parseSheetDate(null)).toBeNull();
      expect(parseSheetDate(undefined)).toBeNull();
      expect(parseSheetDate("")).toBeNull();
      expect(parseSheetDate("   ")).toBeNull();
    });
    it("returns null for unknown formats", () => {
      expect(parseSheetDate("not a date")).toBeNull();
      expect(parseSheetDate("21-08-2025")).toBeNull(); // dashes with day-first not supported
      expect(parseSheetDate("Aug 21 2025")).toBeNull(); // English
    });
    it("returns null for French verbose with unknown month", () => {
      expect(parseSheetDate("Le 1 zaboulou 2025")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// parseEuro
// ---------------------------------------------------------------------------
describe("parseEuro", () => {
  it("parses the standard sheet format", () => {
    expect(parseEuro("23,50 €")).toBe(23.5);
    expect(parseEuro("19,00 €")).toBe(19);
    expect(parseEuro("28,00 €")).toBe(28);
  });
  it("parses negative amounts (refunds, credits)", () => {
    expect(parseEuro("-23,50 €")).toBe(-23.5);
    expect(parseEuro("-129,47 €")).toBe(-129.47);
  });
  it("tolerates missing currency sign", () => {
    expect(parseEuro("23,50")).toBe(23.5);
    expect(parseEuro("23.50")).toBe(23.5);
  });
  it("tolerates non-breaking spaces around the number", () => {
    expect(parseEuro("23,50 €")).toBe(23.5);
  });
  it("returns NaN for empty / non-numeric input", () => {
    expect(parseEuro("")).toBeNaN();
    expect(parseEuro(null)).toBeNaN();
    expect(parseEuro("abc")).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// computeBalances — outstanding-from-invoices (FIFO running tally).
// ---------------------------------------------------------------------------
describe("computeBalances outstanding-from-invoices", () => {
  const joueurs: JoueurRow[] = [
    { Nom: "ALICE Test", Email: "alice@x", Licence: "11111111" },
  ];
  const tarifs: TarifRow[] = [];
  const base = { joueurs, tarifs, dettes: [], tournois: [], tournoisOfferts: [] };

  it("sums all invoices into invoicesTotal", () => {
    const result = computeBalances({
      ...base,
      paiements: [],
      envois: [
        { Nom: "ALICE Test", Montant: "50,00 €", Date: "01/04/2026" },
        { Nom: "ALICE Test", Montant: "30,00 €", Date: "01/07/2026" },
      ],
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.invoicesTotal).toBe(80);
    expect(alice.invoices).toHaveLength(2);
  });

  it("computes outstanding = invoicesTotal − paymentsTotalAll", () => {
    const result = computeBalances({
      ...base,
      paiements: [{ Nom: "ALICE Test", Montant: "50,00 €", Date: "15/04/2026" }],
      envois: [{ Nom: "ALICE Test", Montant: "80,00 €", Date: "01/04/2026" }],
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.outstandingFromInvoices).toBe(30);
  });

  it("clamps outstanding to 0 when overpaid (no negative)", () => {
    const result = computeBalances({
      ...base,
      paiements: [{ Nom: "ALICE Test", Montant: "200,00 €", Date: "15/04/2026" }],
      envois: [{ Nom: "ALICE Test", Montant: "50,00 €", Date: "01/04/2026" }],
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.outstandingFromInvoices).toBe(0);
  });

  it("paymentsTotalAll includes pre-cutoff payments (unlike paymentsTotal)", () => {
    const result = computeBalances({
      ...base,
      paiements: [
        { Nom: "ALICE Test", Montant: "20,00 €", Date: "01/01/2026" }, // pre-cutoff
        { Nom: "ALICE Test", Montant: "30,00 €", Date: "15/05/2026" }, // post-cutoff
      ],
      envois: [],
      cutoffDate: new Date(2026, 3, 1),
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.paymentsTotalAll).toBe(50);   // both counted
    expect(alice.paymentsTotal).toBe(30);       // only post-cutoff
  });

  it("Solde includes prior-period outstanding from Envois + current charges", () => {
    // 100 invoiced + 30 paid → 70 outstanding from prior period.
    // 25 in current period charges. Solde must show 70 + 25 = 95.
    const result = computeBalances({
      ...base,
      tarifs: [{ Item: "RSL", "Catégorie": "Volants", Prix: "25,00 €" }],
      dettes: [{ Nom: "ALICE Test", Item: "RSL", Prix: "25,00 €", Date: "15/05/2026" }],
      paiements: [{ Nom: "ALICE Test", Montant: "30,00 €", Date: "01/05/2026" }],
      envois: [{ Nom: "ALICE Test", Montant: "100,00 €", Date: "01/04/2026" }],
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.outstandingFromInvoices).toBe(70);
    expect(alice.purchasesTotal).toBe(25);
    expect(alice.total).toBe(95);
  });

  it("Solde goes negative when player has overpaid (credit)", () => {
    // 50 invoiced, 80 paid → −30 (credit). No current charges → Solde = −30.
    const result = computeBalances({
      ...base,
      paiements: [{ Nom: "ALICE Test", Montant: "80,00 €", Date: "15/04/2026" }],
      envois: [{ Nom: "ALICE Test", Montant: "50,00 €", Date: "01/04/2026" }],
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.outstandingFromInvoices).toBe(0);
    expect(alice.total).toBe(-30);
  });

  it("returns 0 outstanding when no invoices have been sent yet", () => {
    const result = computeBalances({
      ...base,
      paiements: [],
      envois: [],
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.outstandingFromInvoices).toBe(0);
    expect(alice.invoicesTotal).toBe(0);
    expect(alice.unpaidInvoiceCount).toBe(0);
  });

  it("counts all invoices as unpaid when there are no payments", () => {
    const result = computeBalances({
      ...base,
      paiements: [],
      envois: [
        { Nom: "ALICE Test", Montant: "50,00 €", Date: "01/04/2026" },
        { Nom: "ALICE Test", Montant: "30,00 €", Date: "01/07/2026" },
      ],
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.unpaidInvoiceCount).toBe(2);
  });

  it("FIFO: a payment covering the first invoice marks only later ones unpaid", () => {
    const result = computeBalances({
      ...base,
      paiements: [{ Nom: "ALICE Test", Montant: "50,00 €", Date: "15/04/2026" }],
      envois: [
        { Nom: "ALICE Test", Montant: "50,00 €", Date: "01/04/2026" },
        { Nom: "ALICE Test", Montant: "30,00 €", Date: "01/07/2026" },
      ],
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.unpaidInvoiceCount).toBe(1);
  });

  it("FIFO: a partial payment leaves the boundary invoice unpaid", () => {
    const result = computeBalances({
      ...base,
      paiements: [{ Nom: "ALICE Test", Montant: "65,00 €", Date: "15/04/2026" }],
      envois: [
        { Nom: "ALICE Test", Montant: "50,00 €", Date: "01/04/2026" }, // fully paid
        { Nom: "ALICE Test", Montant: "30,00 €", Date: "01/07/2026" }, // partial (15 covered, 15 left)
        { Nom: "ALICE Test", Montant: "20,00 €", Date: "01/10/2026" }, // fully unpaid
      ],
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.unpaidInvoiceCount).toBe(2);
  });

  it("FIFO: payments covering all invoices leave 0 unpaid", () => {
    const result = computeBalances({
      ...base,
      paiements: [{ Nom: "ALICE Test", Montant: "100,00 €", Date: "15/04/2026" }],
      envois: [
        { Nom: "ALICE Test", Montant: "50,00 €", Date: "01/04/2026" },
        { Nom: "ALICE Test", Montant: "30,00 €", Date: "01/07/2026" },
      ],
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.unpaidInvoiceCount).toBe(0);
  });

  it("exposes the unpaid invoices (with remaining amount for partials)", () => {
    const result = computeBalances({
      ...base,
      paiements: [{ Nom: "ALICE Test", Montant: "65,00 €", Date: "15/04/2026" }],
      envois: [
        { Nom: "ALICE Test", Montant: "50,00 €", Date: "01/04/2026" }, // fully paid
        { Nom: "ALICE Test", Montant: "30,00 €", Date: "01/07/2026" }, // partial: 15 left
        { Nom: "ALICE Test", Montant: "20,00 €", Date: "01/10/2026" }, // fully unpaid
      ],
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.unpaidInvoices).toHaveLength(2);
    expect(alice.unpaidInvoices[0]).toMatchObject({ amount: 15, date: "01/07/2026" });
    expect(alice.unpaidInvoices[1]).toMatchObject({ amount: 20, date: "01/10/2026" });
  });

  it("sorts invoices chronologically before walking (sheet order ignored)", () => {
    // Newest first in sheet — chronological order should make 01/04 the
    // first to be paid by the 50€ payment.
    const result = computeBalances({
      ...base,
      paiements: [{ Nom: "ALICE Test", Montant: "50,00 €", Date: "15/04/2026" }],
      envois: [
        { Nom: "ALICE Test", Montant: "30,00 €", Date: "01/07/2026" },
        { Nom: "ALICE Test", Montant: "50,00 €", Date: "01/04/2026" },
      ],
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    // 50€ payment covers the 01/04 invoice, leaving 01/07 unpaid
    expect(alice.unpaidInvoiceCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeBalances — focused on what cutoff filtering should and shouldn't do.
// ---------------------------------------------------------------------------
describe("computeBalances with cutoff", () => {
  const joueurs: JoueurRow[] = [
    { Nom: "ALICE Test", Email: "alice@x", Licence: "11111111" },
    { Nom: "BOB Test", Email: "bob@x", Licence: "22222222" },
  ];
  const tarifs: TarifRow[] = [
    { Item: "RSL", "Catégorie": "Volants", Prix: "28,00 €" },
  ];
  const tournoisOfferts: TournoiOffertRow[] = [];
  const baseInput = { joueurs, tarifs, tournoisOfferts };

  it("filters out Dettes before cutoff, keeps those on/after", () => {
    const dettes: DetteRow[] = [
      { Nom: "ALICE Test", Item: "RSL", Prix: "28,00 €", Date: "01/01/2026" }, // before
      { Nom: "ALICE Test", Item: "RSL", Prix: "28,00 €", Date: "01/04/2026" }, // on cutoff
      { Nom: "ALICE Test", Item: "RSL", Prix: "28,00 €", Date: "15/04/2026" }, // after
    ];
    const result = computeBalances({
      ...baseInput,
      dettes,
      tournois: [],
      paiements: [],
      cutoffDate: new Date(2026, 3, 1), // April 1
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.lines).toHaveLength(2);
    expect(alice.purchasesTotal).toBe(56);
  });

  it("filters Paiements by cutoff (display list); total counts all payments", () => {
    const dettes: DetteRow[] = [
      { Nom: "ALICE Test", Item: "RSL", Prix: "100,00 €", Date: "15/04/2026" },
    ];
    const paiements: PaiementRow[] = [
      { Nom: "ALICE Test", Montant: "50,00 €", Date: "01/01/2026" }, // before
      { Nom: "ALICE Test", Montant: "30,00 €", Date: "15/05/2026" }, // after
    ];
    const result = computeBalances({
      ...baseInput,
      dettes,
      tournois: [],
      paiements,
      cutoffDate: new Date(2026, 3, 1),
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    // Cutoff filter still applies to the display list and current-period sum
    expect(alice.payments).toHaveLength(1);
    expect(alice.paymentsTotal).toBe(30);
    // total = current charges (100) + invoices (0) − all payments (80) = 20
    expect(alice.total).toBe(20);
  });

  it("keeps every payment in allPayments, regardless of cutoff", () => {
    // allPayments is the list counterpart of paymentsTotalAll. The member page
    // pairs it with `invoices` (also unfiltered) to render a prior-period
    // ledger; using the cutoff-filtered `payments` there would hide older
    // payments and the displayed lines wouldn't sum to the displayed total.
    const paiements: PaiementRow[] = [
      { Nom: "ALICE Test", Montant: "50,00 €", Date: "01/01/2026" }, // before cutoff
      { Nom: "ALICE Test", Montant: "30,00 €", Date: "15/05/2026" }, // after cutoff
    ];
    const result = computeBalances({
      ...baseInput,
      dettes: [],
      tournois: [],
      paiements,
      cutoffDate: new Date(2026, 3, 1),
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;

    expect(alice.allPayments).toHaveLength(2);
    expect(alice.allPayments.map((p) => p.amount)).toEqual([50, 30]);
    // Sums to paymentsTotalAll — that identity is what makes the ledger balance.
    expect(alice.allPayments.reduce((s, p) => s + p.amount, 0)).toBe(alice.paymentsTotalAll);
    // And is strictly a superset of the cutoff-filtered list.
    expect(alice.payments).toHaveLength(1);
  });

  it("allPayments equals payments when there is no cutoff", () => {
    const paiements: PaiementRow[] = [
      { Nom: "ALICE Test", Montant: "50,00 €", Date: "01/01/2026" },
    ];
    const result = computeBalances({
      ...baseInput,
      dettes: [],
      tournois: [],
      paiements,
      cutoffDate: null,
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.allPayments).toEqual(alice.payments);
  });

  it("filters tournaments with parseable dates by cutoff", () => {
    const tournois: TournoiRow[] = [
      { Licence: "11111111", Tournoi: "Old", Date: "Le 1 mars 2026",
        "Montant dû": "20", "Paiement joueur": "0" },
      { Licence: "11111111", Tournoi: "Recent", Date: "Le 1 mai 2026",
        "Montant dû": "20", "Paiement joueur": "0" },
    ];
    const result = computeBalances({
      ...baseInput,
      dettes: [],
      tournois,
      paiements: [],
      cutoffDate: new Date(2026, 3, 1),
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    // Only "Recent" survives; index 0 → every-5th discount → offered
    expect(alice.tournaments).toHaveLength(1);
    expect(alice.tournaments[0]?.name).toBe("Recent");
  });

  it("keeps tournaments with UNPARSEABLE dates (and flags them)", () => {
    const tournois: TournoiRow[] = [
      { Licence: "11111111", Tournoi: "Weird", Date: "around easter",
        "Montant dû": "20", "Paiement joueur": "0" },
    ];
    const result = computeBalances({
      ...baseInput,
      dettes: [],
      tournois,
      paiements: [],
      cutoffDate: new Date(2026, 3, 1),
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.tournaments).toHaveLength(1);
    expect(alice.tournaments[0]?.dateUnparseable).toBe(true);
  });

  it("does not flag tournaments with valid dates", () => {
    const tournois: TournoiRow[] = [
      { Licence: "11111111", Tournoi: "OK", Date: "Le 1 mai 2026",
        "Montant dû": "20", "Paiement joueur": "0" },
    ];
    const result = computeBalances({
      ...baseInput,
      dettes: [],
      tournois,
      paiements: [],
      cutoffDate: new Date(2026, 3, 1),
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.tournaments[0]?.dateUnparseable).toBeFalsy();
  });

  it("every-5th discount counts the FULL season, not just post-cutoff (regression)", () => {
    // Season: T1, T2, T3 (before cutoff), T4, T5 (after cutoff).
    // Full-season positions: T1 free, T5 free. Post-cutoff display should
    // show T4 billed + T5 free — not T4 wrongly marked free because it's
    // index 0 in the filtered window.
    const tournois: TournoiRow[] = [
      { Licence: "11111111", Tournoi: "T1", Date: "Le 1 janvier 2026",
        "Montant dû": "20", "Paiement joueur": "0" },
      { Licence: "11111111", Tournoi: "T2", Date: "Le 1 février 2026",
        "Montant dû": "20", "Paiement joueur": "0" },
      { Licence: "11111111", Tournoi: "T3", Date: "Le 1 mars 2026",
        "Montant dû": "20", "Paiement joueur": "0" },
      { Licence: "11111111", Tournoi: "T4", Date: "Le 1 mai 2026",
        "Montant dû": "20", "Paiement joueur": "0" },
      { Licence: "11111111", Tournoi: "T5", Date: "Le 1 juin 2026",
        "Montant dû": "20", "Paiement joueur": "0" },
    ];
    const result = computeBalances({
      ...baseInput,
      dettes: [],
      tournois,
      paiements: [],
      cutoffDate: new Date(2026, 3, 1), // April 1
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.tournaments.map((t) => t.name)).toEqual(["T4", "T5"]);
    expect(alice.tournaments[0]?.name).toBe("T4");
    expect(alice.tournaments[0]?.due).toBe(20);    // T4 billed
    expect(alice.tournaments[0]?.offered).toBe(false);
    expect(alice.tournaments[1]?.name).toBe("T5");
    expect(alice.tournaments[1]?.due).toBe(0);     // T5 free (position 5 in season)
    expect(alice.tournaments[1]?.offered).toBe(true);
    expect(alice.tournamentsTotal).toBe(20);
  });

  it("no cutoff → no filtering", () => {
    const dettes: DetteRow[] = [
      { Nom: "ALICE Test", Item: "RSL", Prix: "10,00 €", Date: "01/01/2020" },
      { Nom: "ALICE Test", Item: "RSL", Prix: "10,00 €", Date: "01/01/2030" },
    ];
    const result = computeBalances({
      ...baseInput,
      dettes,
      tournois: [],
      paiements: [],
      cutoffDate: null,
    });
    const alice = result.find((p) => p.name === "ALICE Test")!;
    expect(alice.lines).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// computeBalances — tournament-discount rules (regression coverage for the
// "1 free out of every 5" + "Tournois offerts" rules).
// ---------------------------------------------------------------------------
describe("computeBalances tournament rules", () => {
  const player: JoueurRow = { Nom: "X", Email: "", Licence: "1" };
  const tarifs: TarifRow[] = [];

  const t = (name: string, due: number): TournoiRow => ({
    Licence: "1", Tournoi: name, Date: "Le 1 mai 2026",
    "Montant dû": String(due), "Paiement joueur": "0",
  });

  it("offers tournaments at positions 1, 5, 10, 15 (Python parity)", () => {
    const tournois: TournoiRow[] = Array.from({ length: 16 }, (_, i) =>
      t(`Tournament ${i + 1}`, 20));
    const [out] = computeBalances({
      joueurs: [player], tarifs, dettes: [],
      tournois, tournoisOfferts: [], paiements: [],
    });
    const offered = out!.tournaments.filter((x) => x.offered).map((x) => x.name);
    expect(offered).toEqual([
      "Tournament 1", "Tournament 5", "Tournament 10", "Tournament 15",
    ]);
  });

  it('Tournois offerts substring match → due = 0 and offered=true', () => {
    const tournois: TournoiRow[] = [
      { Licence: "1", Tournoi: "Other", Date: "Le 1 mai 2026",
        "Montant dû": "20", "Paiement joueur": "0" },
      { Licence: "1", Tournoi: "Championnat régional jeunes", Date: "Le 7 sept 2025",
        "Montant dû": "30", "Paiement joueur": "0" },
    ];
    const tournoisOfferts: TournoiOffertRow[] = [{ Tournoi: "Championnat régional" }];
    const [out] = computeBalances({
      joueurs: [player], tarifs, dettes: [],
      tournois, tournoisOfferts, paiements: [],
    });
    expect(out!.tournaments[1]?.due).toBe(0);
    expect(out!.tournaments[1]?.offered).toBe(true);
    expect(out!.tournaments[1]?.offeredReason).toBe("in-offered-list");
  });

  it('subtracts paiement joueur from "Montant dû"', () => {
    const tournois: TournoiRow[] = [
      { Licence: "1", Tournoi: "Other", Date: "Le 1 mai 2026",
        "Montant dû": "20", "Paiement joueur": "0" },
      { Licence: "1", Tournoi: "Partly paid", Date: "Le 7 sept 2025",
        "Montant dû": "30", "Paiement joueur": "10" },
    ];
    const [out] = computeBalances({
      joueurs: [player], tarifs, dettes: [],
      tournois, tournoisOfferts: [], paiements: [],
    });
    expect(out!.tournaments[1]?.due).toBe(20);
  });
});
