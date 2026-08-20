import { describe, it, expect } from "vitest";
import { renderRecapEmail } from "../server/utils/email-template";
import type { PlayerBalance } from "../server/utils/debts";

function makePlayer(overrides: Partial<PlayerBalance> = {}): PlayerBalance {
  return {
    name: "DUPONT Jean",
    email: "jean@example.com",
    licence: "12345678",
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
    ...overrides,
  };
}

describe("renderRecapEmail", () => {
  it("greets the player by name", () => {
    const html = renderRecapEmail(makePlayer());
    expect(html).toMatch(/Bonjour DUPONT Jean/);
  });

  it("includes the total dû", () => {
    const html = renderRecapEmail(makePlayer({ total: 123.45 }));
    expect(html).toMatch(/Total dû.*123,45 €/s);
  });

  it("renders a single purchase as 'item (date) → price'", () => {
    const html = renderRecapEmail(
      makePlayer({
        lines: [{ item: "RSL", category: "Volants", price: 28, date: "12/05/2026" }],
        purchasesTotal: 28,
        total: 28,
      }),
    );
    expect(html).toMatch(/<b>RSL<\/b> \(12\/05\/2026\) → 28,00 €/);
    expect(html).not.toMatch(/x <b>RSL/); // no count prefix for 1
  });

  it("aggregates repeated items with a count prefix", () => {
    const html = renderRecapEmail(
      makePlayer({
        lines: [
          { item: "RSL", category: "Volants", price: 28, date: "12/05/2026" },
          { item: "RSL", category: "Volants", price: 28, date: "19/05/2026" },
          { item: "RSL", category: "Volants", price: 28, date: "26/05/2026" },
        ],
        purchasesTotal: 84,
        total: 84,
      }),
    );
    expect(html).toMatch(/3x <b>RSL<\/b> \(12\/05\/2026, 19\/05\/2026, 26\/05\/2026\) → 84,00 €/);
  });

  it("shows a no-purchases fallback when there are no lines", () => {
    const html = renderRecapEmail(makePlayer());
    expect(html).toMatch(/Aucun achat sur la période/);
  });

  it("shows tournament list with win/finalist marks", () => {
    const html = renderRecapEmail(
      makePlayer({
        tournaments: [
          {
            name: "Tournoi de Metz", date: "Le 12 avril 2026",
            due: 28, originalDue: 28, paiementJoueur: 0,
            offered: false, win: true, finalist: false,
          },
          {
            name: "Tournoi de Nancy", date: "Le 26 avril 2026",
            due: 28, originalDue: 28, paiementJoueur: 0,
            offered: false, win: false, finalist: true,
          },
        ],
      }),
    );
    expect(html).toMatch(/🥇<b>Tournoi de Metz<\/b>/);
    expect(html).toMatch(/🥈<b>Tournoi de Nancy<\/b>/);
  });

  it("marks offered tournaments with 🎁 instead of a price", () => {
    const html = renderRecapEmail(
      makePlayer({
        tournaments: [{
          name: "Tournoi gratuit", date: "Le 1 mai 2026",
          due: 0, originalDue: 28, paiementJoueur: 0,
          offered: true, offeredReason: "every-5th",
          win: false, finalist: false,
        }],
      }),
    );
    expect(html).toMatch(/🎁 Offert par Augny Badminton/);
    // The offered tournament <li> shouldn't print a "0,00 €" price after the 🎁 marker.
    expect(html).not.toMatch(/🎁 Offert par Augny Badminton.*0,00 €/);
  });

  it("hides tournaments where paiementJoueur > 0 (Python parity)", () => {
    const html = renderRecapEmail(
      makePlayer({
        tournaments: [
          {
            name: "Already paid offline", date: "Le 1 mai 2026",
            due: 0, originalDue: 28, paiementJoueur: 28,
            offered: false, win: false, finalist: false,
          },
          {
            name: "Still owed", date: "Le 8 mai 2026",
            due: 28, originalDue: 28, paiementJoueur: 0,
            offered: false, win: false, finalist: false,
          },
        ],
      }),
    );
    expect(html).not.toMatch(/Already paid offline/);
    expect(html).toMatch(/Still owed/);
  });

  it("uses the cutoff label in the intro when provided", () => {
    const html = renderRecapEmail(makePlayer(), { cutoffDateLabel: "12/03/2026" });
    expect(html).toMatch(/depuis le <strong>12\/03\/2026<\/strong>/);
  });

  it("falls back to a generic intro when no cutoff is provided", () => {
    const html = renderRecapEmail(makePlayer());
    expect(html).toMatch(/mois précédents/);
  });

  it("includes the RIB link and signature", () => {
    const html = renderRecapEmail(makePlayer());
    expect(html).toMatch(/RIB_Augny_Badminton/);
    expect(html).toMatch(/Rue de la libération 57685 AUGNY/);
  });

  it("includes the club logo image in the header", () => {
    const html = renderRecapEmail(makePlayer());
    expect(html).toMatch(/<img[^>]+src="https:\/\/www\.augny-badminton\.fr\/_nuxt\/logo\.[^"]+\.png"/);
    expect(html).toMatch(/alt="Augny Badminton"/);
  });

  it("lists unpaid invoices from previous recaps when present", () => {
    const html = renderRecapEmail(
      makePlayer({
        unpaidInvoices: [
          { amount: 30, date: "01/07/2026", note: "Récap trimestriel" },
          { amount: 20, date: "01/10/2026", note: "Récap trimestriel" },
        ],
        unpaidInvoiceCount: 2,
        total: 50,
      }),
    );
    expect(html).toMatch(/Factures non réglées des périodes précédentes/);
    expect(html).toMatch(/<b>Récap trimestriel<\/b> \(01\/07\/2026\) → 30,00 €/);
    expect(html).toMatch(/<b>Récap trimestriel<\/b> \(01\/10\/2026\) → 20,00 €/);
  });

  it("does not show the unpaid-invoices section when there are none", () => {
    const html = renderRecapEmail(makePlayer());
    expect(html).not.toMatch(/Factures non réglées/);
  });

  it("escapes HTML special chars in player name / item / tournament name", () => {
    const html = renderRecapEmail(
      makePlayer({
        name: "<script>evil</script>",
        lines: [{ item: "Some & item", category: "x", price: 1, date: "01/01/2026" }],
        tournaments: [{
          name: "<img onerror=x>", date: "Le 1 mai 2026",
          due: 10, originalDue: 10, paiementJoueur: 0,
          offered: false, win: false, finalist: false,
        }],
      }),
    );
    expect(html).not.toMatch(/<script>evil<\/script>/);
    expect(html).toMatch(/&lt;script&gt;evil&lt;\/script&gt;/);
    expect(html).toMatch(/Some &amp; item/);
    expect(html).toMatch(/&lt;img onerror=x&gt;/);
  });
});

describe("renderRecapEmail — performance highlight", () => {
  const baseTournament = {
    date: "Le 1 mai 2026", due: 28, originalDue: 28, paiementJoueur: 0,
    offered: false, win: false, finalist: false,
  };

  it("celebrates a win first (priority over everything else)", () => {
    const html = renderRecapEmail(makePlayer({
      tournaments: [
        { ...baseTournament, name: "Tournoi de Metz", win: true },
        { ...baseTournament, name: "Tournoi de Nancy", finalist: true },
      ],
    }));
    expect(html).toMatch(/🥇 Bravo pour ta victoire à Tournoi de Metz/);
    expect(html).not.toMatch(/Belle finale/);
  });

  it("falls back to finale when no win", () => {
    const html = renderRecapEmail(makePlayer({
      tournaments: [{ ...baseTournament, name: "Tournoi de Nancy", finalist: true }],
    }));
    expect(html).toMatch(/🥈 Belle finale à Tournoi de Nancy/);
  });

  it("falls back to régularité when no podium and ≥4 tournaments", () => {
    const html = renderRecapEmail(makePlayer({
      tournaments: Array.from({ length: 4 }, (_, i) => ({
        ...baseTournament, name: `T${i + 1}`,
      })),
    }));
    expect(html).toMatch(/📈 4 tournois sur la période, belle régularité/);
  });

  it("falls back to volants when ≥4 shuttle-box purchases and no other highlight", () => {
    const html = renderRecapEmail(makePlayer({
      lines: Array.from({ length: 5 }, (_, i) => ({
        item: "RSL", category: "Volants", price: 28, date: `0${i + 1}/05/2026`,
      })),
    }));
    expect(html).toMatch(/🏸 5 boîtes de volants — tu joues fort ce trimestre/);
  });

  it("ignores shuttle refunds (negative price) for the count", () => {
    const lines = [
      ...Array.from({ length: 4 }, (_, i) => ({
        item: "RSL", category: "Volants", price: 28, date: `0${i + 1}/05/2026`,
      })),
      { item: "RSL", category: "Volants", price: -28, date: "10/05/2026" },
      { item: "RSL", category: "Volants", price: -28, date: "11/05/2026" },
    ];
    const html = renderRecapEmail(makePlayer({ lines }));
    expect(html).toMatch(/🏸 4 boîtes de volants/);
  });

  it("renders no highlight when nothing fires", () => {
    const html = renderRecapEmail(makePlayer({
      tournaments: [
        { ...baseTournament, name: "T1" },
        { ...baseTournament, name: "T2" },
      ],
      lines: [{ item: "RSL", category: "Volants", price: 28, date: "01/05/2026" }],
    }));
    expect(html).not.toMatch(/🥇|🥈|📈|🏸/);
  });

  it("does not count tournaments toward régularité until ≥4", () => {
    const html = renderRecapEmail(makePlayer({
      tournaments: Array.from({ length: 3 }, (_, i) => ({
        ...baseTournament, name: `T${i + 1}`,
      })),
    }));
    expect(html).not.toMatch(/belle régularité/);
  });

  it("escapes HTML in the tournament name used in the highlight", () => {
    const html = renderRecapEmail(makePlayer({
      tournaments: [{ ...baseTournament, name: "<script>x</script>", win: true }],
    }));
    expect(html).toMatch(/Bravo pour ta victoire à &lt;script&gt;x&lt;\/script&gt;/);
  });

});
