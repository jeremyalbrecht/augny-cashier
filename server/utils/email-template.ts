// Renders the quarterly recap e-mail HTML from a PlayerBalance.
// Ports the layout from the legacy Python `models.py prepare_email_content`,
// with the same business rules:
//   - Group debts by item: "3x RSL (dates) → 84,00 €" / "RSL (date) → 28,00 €"
//   - Skip tournaments where paiementJoueur > 0 (player paid offline)
//   - 🥇/🥈 for wins / finalists, 🎁 for offered tournaments
//   - RIB link + signature
//
// Inline styles only — most e-mail clients strip <style>/<link> tags.
// Layout uses a single outer <table> for Outlook reliability; inner content
// uses padded <div>s for readability.

import type { PlayerBalance } from "#server/utils/debts";

const RIB_URL = "https://augny-badminton.s3.gra.io.cloud.ovh.net/RIB_Augny_Badminton_2e76e55642.pdf";
// Logo hosted on the club's public website. URL has a build hash — if the
// site is rebuilt this may rotate; update here if the image stops loading.
const LOGO_URL = "https://www.augny-badminton.fr/_nuxt/logo.f3773237.png";

// Brand palette — matches the navy used in the /dettes admin UI and the
// club's existing end-of-season e-mail (offered_tournaments.py).
const NAVY = "#0a1f44";
const BG = "#f4f8fc";
const CARD_BORDER = "#e5e7eb";
const TEXT = "#1a1a1a";
const MUTED = "#6b7280";
const ACCENT_GREEN = "#16a34a";
const TOTAL_BG = "#eef4ff";

function formatEuro(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface GroupedDebt {
  item: string;
  unitPrice: number;
  dates: string[];
  total: number;
}

function groupDebtLines(lines: PlayerBalance["lines"]): GroupedDebt[] {
  const map = new Map<string, GroupedDebt>();
  for (const l of lines) {
    let g = map.get(l.item);
    if (!g) {
      g = { item: l.item, unitPrice: l.price, dates: [], total: 0 };
      map.set(l.item, g);
    }
    g.dates.push(l.date);
    g.total += l.price;
  }
  return Array.from(map.values());
}

export interface RenderEmailOptions {
  /** Cutoff date the recap covers, as DD/MM/YYYY. If set, the intro mentions it. */
  cutoffDateLabel?: string | null;
}

const SECTION_HEADER = `font-size: 11px; font-weight: 700; color: ${NAVY}; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 10px 0;`;
const ROW = `padding: 10px 0; border-top: 1px solid ${CARD_BORDER}; font-size: 14px; color: ${TEXT}; line-height: 1.4;`;

// One short positive line surfacing the most impressive thing the player did
// this period. Priority order: win > finalist > regularity > shuttle volume.
// All thresholds are intentionally simple — easy to tweak from a single place.
const REGULARITY_THRESHOLD = 4;
const SHUTTLE_THRESHOLD = 4;

function pickHighlight(player: PlayerBalance): string | null {
  const winner = player.tournaments.find((t) => t.win);
  if (winner) return `🥇 Bravo pour ta victoire à ${escapeHtml(winner.name)} !`;

  const finalist = player.tournaments.find((t) => t.finalist);
  if (finalist) return `🥈 Belle finale à ${escapeHtml(finalist.name)} !`;

  if (player.tournaments.length >= REGULARITY_THRESHOLD) {
    return `📈 ${player.tournaments.length} tournois sur la période, belle régularité !`;
  }
  const shuttleCount = player.lines.filter((l) => l.category === "Volants" && l.price > 0).length;
  if (shuttleCount >= SHUTTLE_THRESHOLD) {
    return `🏸 ${shuttleCount} boîtes de volants — tu joues fort ce trimestre !`;
  }
  return null;
}

export function renderRecapEmail(player: PlayerBalance, opts: RenderEmailOptions = {}): string {
  const grouped = groupDebtLines(player.lines);
  const tournaments = player.tournaments.filter((t) => t.paiementJoueur === 0);

  const introCutoff = opts.cutoffDateLabel
    ? `<p style="margin: 0; font-size: 14px; color: ${MUTED}; line-height: 1.5;">Voici le détail de tes dettes accumulées depuis le <strong>${escapeHtml(opts.cutoffDateLabel)}</strong>.</p>`
    : `<p style="margin: 0; font-size: 14px; color: ${MUTED}; line-height: 1.5;">Voici le détail de tes dettes pour les mois précédents.</p>`;

  const highlight = pickHighlight(player);
  const highlightBlock = highlight
    ? `<p style="margin: 14px 0 0 0; padding: 12px 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; font-size: 14px; color: #064e3b; line-height: 1.4;">${highlight}</p>`
    : "";

  const debtListItems = grouped.map((g) => {
    const dates = g.dates.join(", ");
    const count = g.dates.length;
    const itemLabel = `<b>${escapeHtml(g.item)}</b>`;
    const prefix = count > 1 ? `${count}x ${itemLabel}` : itemLabel;
    return `<div style="${ROW}">${prefix} (${escapeHtml(dates)}) → ${formatEuro(g.total)}</div>`;
  }).join("");

  const tournamentListItems = tournaments.map((t) => {
    const marks = `${t.win ? "🥇" : ""}${t.finalist ? "🥈" : ""}`;
    const trail = t.offered
      ? ` <span style="color: ${ACCENT_GREEN};">🎁 Offert par Augny Badminton</span>`
      : ` ${formatEuro(t.due)}`;
    const namePart = `<b>${escapeHtml(t.name)}</b>`;
    return `<div style="${ROW}">${marks}${namePart} (${escapeHtml(t.date)})${trail}</div>`;
  }).join("");

  // Wrap a list in a section card. Top border is supplied by the first row
  // itself (border-top on `.row`), so the card has no extra hairline.
  function sectionCard(label: string, body: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 16px 0;">
      <tr><td style="padding: 18px 22px; background: #ffffff; border: 1px solid ${CARD_BORDER}; border-radius: 10px;">
        <p style="${SECTION_HEADER}">${label}</p>
        <div>${body}</div>
      </td></tr>
    </table>`;
  }

  const debtSection = debtListItems
    ? sectionCard("🛒 Achats", debtListItems)
    : sectionCard("🛒 Achats", `<p style="margin: 0; color: ${MUTED}; font-style: italic; font-size: 14px;">Aucun achat sur la période.</p>`);

  const tournamentSection = tournamentListItems
    ? sectionCard("🏆 Tournois", tournamentListItems)
    : "";

  // Surface invoices from previous recaps that are still (fully or partially)
  // unpaid. The amount carried by `unpaidInvoices` is the remaining unpaid
  // portion, so a 50€ invoice with 30€ left shows "30,00 €".
  const unpaidInvoiceItems = player.unpaidInvoices.map((inv) => {
    const label = inv.note ? escapeHtml(inv.note) : "Récap";
    return `<div style="${ROW}"><b>${label}</b> (${escapeHtml(inv.date)}) → ${formatEuro(inv.amount)}</div>`;
  }).join("");
  const unpaidInvoicesSection = unpaidInvoiceItems
    ? sectionCard("⚠️ Factures non réglées des périodes précédentes", unpaidInvoiceItems)
    : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Récap Augny Badminton</title>
</head>
<body style="margin: 0; padding: 24px 12px; background: ${BG}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: ${TEXT};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width: 580px; margin: 0 auto;">
    <!-- Header: white card with dark club logo, navy accent bar underneath -->
    <tr>
      <td style="background: #ffffff; padding: 28px 28px 18px 28px; text-align: center; border-radius: 12px 12px 0 0;">
        <img src="${LOGO_URL}" alt="Augny Badminton" width="120" style="display: inline-block; height: auto; max-width: 120px; border: 0;">
      </td>
    </tr>
    <tr>
      <td style="background: ${NAVY}; padding: 10px 28px; text-align: center;">
        <p style="margin: 0; font-size: 11px; color: #ffffff; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em;">
          Récap trimestriel
        </p>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="background: #ffffff; padding: 24px 28px;">
        <p style="margin: 0 0 6px 0; font-size: 16px; font-weight: 600;">Bonjour ${escapeHtml(player.name)},</p>
        ${introCutoff}
        ${highlightBlock}
      </td>
    </tr>

    <!-- Sections -->
    <tr>
      <td style="padding: 0 6px;">
        ${unpaidInvoicesSection}
        ${debtSection}
        ${tournamentSection}
      </td>
    </tr>

    <!-- Total card -->
    <tr>
      <td style="padding: 0 6px 16px 6px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding: 22px; background: ${TOTAL_BG}; border-radius: 10px; text-align: center;">
              <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: 700; color: ${NAVY}; text-transform: uppercase; letter-spacing: 0.08em;">
                Total dû
              </p>
              <p style="margin: 0 0 16px 0; font-size: 32px; font-weight: 700; color: ${NAVY}; letter-spacing: -0.02em;">
                ${formatEuro(player.total)}
              </p>
              <a href="${RIB_URL}" style="display: inline-block; padding: 10px 22px; background: ${NAVY}; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px;">
                💳 Télécharger le RIB
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Reminder + signature -->
    <tr>
      <td style="background: #ffffff; padding: 18px 28px; border-radius: 0 0 12px 12px;">
        <p style="margin: 0 0 14px 0; font-size: 12px; color: ${MUTED}; line-height: 1.5;">
          Pour rappel, Augny Badminton offre un tournoi toutes les 5 participations.
        </p>
        <p style="margin: 0; font-size: 12px; color: ${MUTED}; line-height: 1.5;">
          Sportivement,<br>
          <strong style="color: ${TEXT};">Augny Badminton</strong><br>
          Rue de la libération 57685 AUGNY
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
