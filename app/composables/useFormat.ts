// Shared French formatting helpers.
//
// The Euro formatter and the red/green/neutral balance colouring were
// duplicated verbatim in index.vue and dettes.vue; mon-compte.vue would have
// made a third copy. Auto-imported by Nuxt from app/composables/.

/** French euro formatter — `23,50 €`. Matches the sheet's own notation. */
export const Euro = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

/**
 * Tailwind classes for a balance: red when the member owes the club, green
 * when they're in credit, neutral when settled. The 0.01 dead-zone keeps
 * floating-point dust from painting a settled account red.
 */
export function balanceClass(n: number | null | undefined): string {
  if (n == null) return "";
  if (n > 0.01) return "text-red-600 dark:text-red-400";
  if (n < -0.01) return "text-green-600 dark:text-green-400";
  return "text-gray-500";
}

/** Short label that pairs with `balanceClass` — "doit" / "crédit" / "à jour". */
export function balanceLabel(n: number | null | undefined): string {
  if (n == null) return "";
  if (n > 0.01) return "doit";
  if (n < -0.01) return "crédit";
  return "à jour";
}

/** `2026-08-14` → `14/08/2026`. Returns null for empty/malformed input. */
export function isoToFR(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return null;
  return `${d}/${m}/${y}`;
}
