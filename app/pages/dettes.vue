<script setup lang="ts">
interface DebtLine {
  item: string;
  category: string;
  price: number;
  date: string;
}
interface TournamentLine {
  name: string;
  date: string;
  place?: string;
  due: number;
  originalDue: number;
  offered: boolean;
  offeredReason?: string;
  win: boolean;
  finalist: boolean;
  dateUnparseable?: boolean;
}
interface UnparseableTournamentDate {
  player: string;
  tournament: string;
  rawDate: string;
}
interface PaymentLine {
  amount: number;
  date: string;
  method?: string;
  note?: string;
}
interface InvoiceLine {
  amount: number;
  date: string;
  note?: string;
}
interface PlayerBalance {
  name: string;
  email?: string;
  licence?: string;
  purchasesTotal: number;
  tournamentsTotal: number;
  paymentsTotal: number;
  total: number;
  lines: DebtLine[];
  tournaments: TournamentLine[];
  payments: PaymentLine[];
  invoicesTotal: number;
  paymentsTotalAll: number;
  outstandingFromInvoices: number;
  invoices: InvoiceLine[];
  unpaidInvoiceCount: number;
  unpaidInvoices: InvoiceLine[];
}
interface DebtsResponse {
  data: PlayerBalance[];
  summary: {
    playerCount: number;
    totalOwed: number;
    unpaidCount: number;
    totalUnpaid: number;
    cutoffDate: string | null;
    unparseableTournamentDates: UnparseableTournamentDate[];
  };
}

const { loggedIn, user, clear: clearSession } = useUserSession();

const debts = ref<DebtsResponse | null>(null);
const loading = ref(false);
const forbidden = ref(false);
const loadError = ref<string | null>(null);

async function loadDebts() {
  loading.value = true;
  forbidden.value = false;
  loadError.value = null;
  try {
    debts.value = await $fetch<DebtsResponse>("/api/debts");
  } catch (e: unknown) {
    const status = (e as { statusCode?: number; status?: number })?.statusCode
      ?? (e as { status?: number })?.status;
    if (status === 403) forbidden.value = true;
    else loadError.value = (e as { statusMessage?: string; message?: string })?.statusMessage
      ?? (e as { message?: string })?.message
      ?? "Erreur inconnue";
  } finally {
    loading.value = false;
  }
}

watch(loggedIn, (val) => {
  if (val) loadDebts();
  else debts.value = null;
}, { immediate: true });

const search = ref("");
const onlyDebtors = ref(true);
const selectedName = ref<string | null>(null);
const detailEl = ref<HTMLElement | null>(null);

// On mobile, the list and detail swap (iOS-style). When a player is selected,
// scroll the detail section to the top of the viewport so the user doesn't
// have to find it past the summary cards / filters.
watch(selectedName, async (val) => {
  if (!val) return;
  if (typeof window === "undefined") return;
  if (window.matchMedia("(min-width: 1024px)").matches) return; // desktop: no swap
  await nextTick();
  detailEl.value?.scrollIntoView({ behavior: "smooth", block: "start" });
});

const players = computed(() => debts.value?.data ?? []);
const filtered = computed(() => {
  let list = players.value;
  if (onlyDebtors.value) list = list.filter((p) => p.total > 0.01);
  const q = search.value.trim().toLowerCase();
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
  return list;
});
const selected = computed(() =>
  players.value.find((p) => p.name === selectedName.value) ?? null,
);

const summary = computed(() => debts.value?.summary);
const cutoffDisplay = computed(() => {
  const iso = summary.value?.cutoffDate;
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
});
const unparseable = computed(() => summary.value?.unparseableTournamentDates ?? []);
const showUnparseable = ref(false);

const Euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const balanceClass = (n: number) => {
  if (n > 0.01) return "text-red-600 dark:text-red-400";
  if (n < -0.01) return "text-green-600 dark:text-green-400";
  return "text-gray-400";
};

// --- Payment form ---
const paymentOpen = ref(false);
const paymentForm = reactive({
  montant: "",
  date: "",
  methode: "Virement",
  note: "",
});
const paymentSubmitting = ref(false);
const paymentError = ref<string | null>(null);

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseFrDate(s: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return 0;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

function lastInvoiceAmount(p: PlayerBalance): number | null {
  if (!p.invoices.length) return null;
  // Sort by date desc, fall back to insertion order for unparseable dates.
  const sorted = [...p.invoices].sort((a, b) => parseFrDate(b.date) - parseFrDate(a.date));
  return sorted[0]?.amount ?? null;
}

function openPaymentForm() {
  if (!selected.value) return;
  // Pre-populate with the amount of the most recent recap email — most
  // payments refer to that invoice. Fall back to the current Solde, then empty.
  const lastInvoice = lastInvoiceAmount(selected.value);
  const prefill = lastInvoice ?? (selected.value.total > 0 ? selected.value.total : null);
  paymentForm.montant = prefill != null ? prefill.toFixed(2) : "";
  paymentForm.date = todayIsoDate();
  paymentForm.methode = "Virement";
  paymentForm.note = "";
  paymentError.value = null;
  paymentOpen.value = true;
}

async function submitPayment() {
  if (!selected.value) return;
  const amount = Number(paymentForm.montant);
  if (!Number.isFinite(amount) || amount === 0) {
    paymentError.value = "Montant invalide";
    return;
  }
  paymentSubmitting.value = true;
  paymentError.value = null;
  try {
    const [y, m, d] = paymentForm.date.split("-");
    await $fetch("/api/payments", {
      method: "POST",
      body: {
        nom: selected.value.name,
        montant: amount,
        date: `${d}/${m}/${y}`,
        methode: paymentForm.methode,
        note: paymentForm.note,
      },
    });
    paymentOpen.value = false;
    await loadDebts();
  } catch (e: unknown) {
    paymentError.value = (e as { statusMessage?: string; message?: string })?.statusMessage
      ?? (e as { message?: string })?.message
      ?? "Erreur lors de l'enregistrement";
  } finally {
    paymentSubmitting.value = false;
  }
}

async function doLogout() {
  await clearSession();
  selectedName.value = null;
  debts.value = null;
}

// --- Send recap (quarterly emails) ---
interface SendResult {
  name: string;
  email: string | null;
  status: "sent" | "skipped" | "error";
  reason?: string;
}
interface SendResponse {
  results: SendResult[];
  sentCount: number;
  skippedCount: number;
  errorCount: number;
  newCutoffDate: string | null;
}

const recapOpen = ref(false);
const recapStep = ref<"list" | "confirm" | "sending" | "results">("list");
const recapSelected = ref<Set<string>>(new Set());
const recapResults = ref<SendResponse | null>(null);
const recapError = ref<string | null>(null);

const debtorsForRecap = computed(() => players.value.filter((p) => p.total > 0.01));
const recapSendableCount = computed(() => {
  return debtorsForRecap.value.filter((p) =>
    recapSelected.value.has(p.name) && !!p.email,
  ).length;
});

function openRecap() {
  recapSelected.value = new Set(debtorsForRecap.value.map((p) => p.name));
  recapStep.value = "list";
  recapResults.value = null;
  recapError.value = null;
  recapOpen.value = true;
}
function toggleRecapPlayer(name: string) {
  const next = new Set(recapSelected.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  recapSelected.value = next;
}
function selectAllRecap() {
  recapSelected.value = new Set(debtorsForRecap.value.map((p) => p.name));
}
function clearAllRecap() {
  recapSelected.value = new Set();
}
async function confirmSendRecap() {
  recapStep.value = "sending";
  recapError.value = null;
  try {
    const res = await $fetch<SendResponse>("/api/send-summary", {
      method: "POST",
      body: { names: Array.from(recapSelected.value) },
    });
    recapResults.value = res;
    recapStep.value = "results";
    // The cutoff likely advanced — refresh balances in the background.
    loadDebts();
  } catch (e: unknown) {
    recapError.value = (e as { statusMessage?: string; message?: string })?.statusMessage
      ?? (e as { message?: string })?.message
      ?? "Erreur lors de l'envoi";
    recapStep.value = "list";
  }
}

// --- Preview ---
const previewOpen = ref(false);
const previewLoading = ref(false);
const previewHtml = ref<string | null>(null);
const previewError = ref<string | null>(null);
const previewForName = ref<string | null>(null);

async function openPreview(name: string) {
  previewForName.value = name;
  previewOpen.value = true;
  previewLoading.value = true;
  previewError.value = null;
  previewHtml.value = null;
  try {
    const res = await $fetch<{ html: string }>(
      `/api/send-summary/preview/${encodeURIComponent(name)}`,
    );
    previewHtml.value = res.html;
  } catch (e: unknown) {
    previewError.value = (e as { statusMessage?: string; message?: string })?.statusMessage
      ?? (e as { message?: string })?.message
      ?? "Erreur";
  } finally {
    previewLoading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-950">
    <header class="bg-[#0a1f44] text-white">
      <div class="max-w-screen-xl mx-auto px-4 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <img src="~/assets/images/logo.png" class="w-12 brightness-0 invert" alt="Augny Badminton" />
          <div>
            <h1 class="text-lg font-semibold">Dettes adhérents</h1>
            <p class="text-xs text-blue-100/70">Augny Badminton</p>
          </div>
        </div>
        <div v-if="loggedIn" class="flex items-center gap-3">
          <div class="text-right text-sm hidden sm:block">
            <p class="font-medium">{{ user?.name ?? user?.email }}</p>
            <p class="text-xs text-blue-100/70">{{ user?.email }}</p>
          </div>
          <button
            type="button"
            class="text-sm px-3 py-1.5 rounded-md border border-white/20 hover:bg-white/10"
            @click="doLogout"
          >
            Déconnexion
          </button>
        </div>
      </div>
    </header>

    <main class="max-w-screen-xl mx-auto px-4 py-6">
      <!-- 1. Not logged in -->
      <div v-if="!loggedIn" class="flex flex-col items-center justify-center py-24 gap-6">
        <div class="text-center max-w-md">
          <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Accès réservé</h2>
          <p class="text-gray-600 dark:text-gray-400">
            Cette page est réservée aux membres du Comité. Connectez-vous avec votre compte Google.
          </p>
        </div>
        <a
          href="/auth/google"
          class="inline-flex items-center gap-3 px-6 py-3 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 font-medium text-gray-700"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.6 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.3 0-.6-.1-1.1-.2-1.6H12z" />
          </svg>
          Se connecter avec Google
        </a>
      </div>

      <!-- 2. Logged in but not allowlisted -->
      <div v-else-if="forbidden" class="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Accès non autorisé</h2>
        <p class="text-gray-600 dark:text-gray-400 max-w-md">
          Vous êtes connecté en tant que <strong>{{ user?.email }}</strong> mais cet e-mail n'est pas
          dans la feuille <em>Comité</em>. Demandez à un administrateur de l'ajouter.
        </p>
        <button
          type="button"
          class="text-sm px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          @click="doLogout"
        >
          Changer de compte
        </button>
      </div>

      <!-- 3. Loading -->
      <div v-else-if="loading && !debts" class="py-24 text-center text-gray-500">
        Chargement…
      </div>

      <!-- 4. Generic error -->
      <div v-else-if="loadError" class="py-24 text-center">
        <p class="text-red-600 dark:text-red-400 mb-3">{{ loadError }}</p>
        <button
          type="button"
          class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          @click="loadDebts"
        >
          Réessayer
        </button>
      </div>

      <!-- 5. Logged in & authorized -->
      <template v-else-if="debts">
        <!-- Cutoff banner -->
        <div
          v-if="cutoffDisplay"
          class="mb-4 px-4 py-2 rounded-md bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-sm text-blue-900 dark:text-blue-200"
        >
          Soldes calculés à partir du <strong>{{ cutoffDisplay }}</strong> (date du dernier envoi e-mail).
        </div>
        <div
          v-else
          class="mb-4 px-4 py-2 rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-200"
        >
          Aucune date de coupure trouvée dans la feuille <em>Data</em> — les soldes incluent tout l'historique.
        </div>

        <!-- Unparseable tournament dates -->
        <div
          v-if="unparseable.length"
          class="mb-4 px-4 py-3 rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-200"
        >
          <button
            type="button"
            class="flex items-center gap-2 font-medium w-full text-left"
            @click="showUnparseable = !showUnparseable"
          >
            <span>⚠️</span>
            <span>
              {{ unparseable.length }} tournoi(s) avec une date non reconnue —
              ces tournois sont quand même facturés mais le filtre par date de coupure ne s'applique pas.
            </span>
            <span class="ml-auto text-xs">{{ showUnparseable ? "Masquer" : "Voir" }}</span>
          </button>
          <ul v-if="showUnparseable" class="mt-2 ml-6 list-disc text-xs space-y-1">
            <li v-for="(u, i) in unparseable" :key="i">
              <strong>{{ u.player }}</strong> — {{ u.tournament }}
              <span class="text-amber-700 dark:text-amber-300">(date : « {{ u.rawDate || "vide" }} »)</span>
            </li>
          </ul>
        </div>

        <!-- Summary cards -->
        <section class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
            <p class="text-xs uppercase tracking-wide text-gray-500">Joueurs</p>
            <p class="text-2xl font-semibold mt-1">{{ summary?.playerCount }}</p>
          </div>
          <div class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
            <p class="text-xs uppercase tracking-wide text-gray-500">Total dû au club</p>
            <p class="text-2xl font-semibold mt-1 text-red-600 dark:text-red-400">
              {{ Euro.format(summary?.totalOwed ?? 0) }}
            </p>
          </div>
          <div class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
            <p class="text-xs uppercase tracking-wide text-gray-500">Non payés</p>
            <p class="text-2xl font-semibold mt-1 text-amber-600 dark:text-amber-400">
              {{ summary?.unpaidCount ?? 0 }}
              <span class="text-sm font-normal text-gray-500 ml-1">
                ({{ Euro.format(summary?.totalUnpaid ?? 0) }})
              </span>
            </p>
            <p class="text-xs text-gray-500 mt-1">Facturés et non réglés</p>
          </div>
        </section>

        <!-- Filters -->
        <section class="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            v-model="search"
            type="text"
            placeholder="Rechercher un adhérent…"
            class="flex-1 px-4 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
          />
          <label class="inline-flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md text-sm">
            <input v-model="onlyDebtors" type="checkbox" class="accent-blue-600" />
            Débiteurs uniquement
          </label>
          <button
            type="button"
            class="px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
            :disabled="loading"
            @click="loadDebts"
          >
            {{ loading ? "Actualisation…" : "Actualiser" }}
          </button>
          <button
            type="button"
            class="px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            :disabled="!debtorsForRecap.length"
            @click="openRecap"
          >
            Envoyer le récap ({{ debtorsForRecap.length }})
          </button>
        </section>

        <!-- Two-column: list + detail -->
        <div class="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <!-- List — hidden on mobile when a player is selected (iOS-style swap) -->
          <section
            class="lg:col-span-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
            :class="{ 'hidden lg:block': selectedName }"
          >
            <div class="max-h-[70vh] overflow-y-auto">
              <p v-if="!filtered.length" class="p-6 text-center text-sm text-gray-500">
                Aucun joueur à afficher.
              </p>
              <button
                v-for="p in filtered"
                :key="p.name"
                type="button"
                class="w-full flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                :class="selectedName === p.name ? 'bg-blue-50 dark:bg-blue-900/30' : ''"
                @click="selectedName = p.name"
              >
                <span class="flex items-center gap-2 min-w-0">
                  <span class="font-medium text-gray-900 dark:text-white truncate">{{ p.name }}</span>
                  <span
                    v-if="p.unpaidInvoiceCount > 0"
                    class="shrink-0 px-1.5 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    :title="`${p.unpaidInvoiceCount} facture(s) non payée(s)`"
                  >
                    {{ p.unpaidInvoiceCount }}
                  </span>
                </span>
                <span class="font-semibold tabular-nums shrink-0 ml-2" :class="balanceClass(p.total)">
                  {{ Euro.format(p.total) }}
                </span>
              </button>
            </div>
          </section>

          <!-- Detail — hidden on mobile until a player is selected -->
          <section
            ref="detailEl"
            class="lg:col-span-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-5 scroll-mt-4"
            :class="{ 'hidden lg:block': !selectedName }"
          >
            <button
              v-if="selected"
              type="button"
              class="lg:hidden mb-4 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
              @click="selectedName = null"
            >
              ← Retour à la liste
            </button>
            <div v-if="!selected" class="text-center text-sm text-gray-500 py-24">
              Sélectionnez un adhérent pour voir le détail.
            </div>
            <template v-else>
              <div class="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h2 class="text-xl font-semibold text-gray-900 dark:text-white">{{ selected.name }}</h2>
                  <p v-if="selected.email" class="text-sm text-gray-500">{{ selected.email }}</p>
                </div>
                <div class="text-right">
                  <p class="text-xs uppercase tracking-wide text-gray-500">Solde</p>
                  <p class="text-2xl font-semibold tabular-nums" :class="balanceClass(selected.total)">
                    {{ Euro.format(selected.total) }}
                  </p>
                </div>
              </div>

              <div class="grid grid-cols-3 text-sm text-gray-600 dark:text-gray-400 mb-3 gap-2">
                <div>
                  <p class="text-xs uppercase tracking-wide">Achats</p>
                  <p class="tabular-nums">{{ Euro.format(selected.purchasesTotal) }}</p>
                </div>
                <div>
                  <p class="text-xs uppercase tracking-wide">Tournois</p>
                  <p class="tabular-nums">{{ Euro.format(selected.tournamentsTotal) }}</p>
                </div>
                <div>
                  <p class="text-xs uppercase tracking-wide">Paiements</p>
                  <p class="tabular-nums">{{ Euro.format(selected.paymentsTotal) }}</p>
                </div>
              </div>

              <div
                v-if="selected.outstandingFromInvoices > 0.01"
                class="mb-4 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-sm flex items-center justify-between"
              >
                <span class="text-amber-900 dark:text-amber-200">
                  Non payé sur factures envoyées
                </span>
                <span class="font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                  {{ Euro.format(selected.outstandingFromInvoices) }}
                </span>
              </div>

              <div class="flex gap-2 mb-5">
                <button
                  type="button"
                  class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
                  @click="openPaymentForm"
                >
                  Enregistrer un paiement
                </button>
              </div>

              <!-- Line items -->
              <details class="mb-3" open>
                <summary class="cursor-pointer font-medium text-sm text-gray-700 dark:text-gray-300 select-none">
                  Achats ({{ selected.lines.length }})
                </summary>
                <ul class="mt-2 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                  <li v-for="(l, i) in selected.lines" :key="i" class="flex justify-between py-1.5">
                    <span class="text-gray-700 dark:text-gray-300">
                      <span class="text-gray-400 text-xs mr-2">{{ l.date }}</span>
                      {{ l.item }}
                    </span>
                    <span class="tabular-nums" :class="l.price < 0 ? 'text-green-600' : ''">
                      {{ Euro.format(l.price) }}
                    </span>
                  </li>
                </ul>
              </details>

              <details v-if="selected.tournaments.length" class="mb-3">
                <summary class="cursor-pointer font-medium text-sm text-gray-700 dark:text-gray-300 select-none">
                  Tournois ({{ selected.tournaments.length }})
                </summary>
                <ul class="mt-2 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                  <li v-for="(t, i) in selected.tournaments" :key="i" class="flex justify-between py-1.5">
                    <span class="text-gray-700 dark:text-gray-300">
                      <span class="text-gray-400 text-xs mr-2">{{ t.date }}</span>
                      <span
                        v-if="t.dateUnparseable"
                        class="mr-1"
                        title="Date non reconnue — corrigez le format dans la feuille Tournois N"
                      >⚠️</span>
                      <span v-if="t.win" class="mr-1">🥇</span>
                      <span v-if="t.finalist" class="mr-1">🥈</span>
                      {{ t.name }}
                      <span v-if="t.offered" class="ml-1 text-xs text-green-600">🎁 offert</span>
                    </span>
                    <span class="tabular-nums">{{ Euro.format(t.due) }}</span>
                  </li>
                </ul>
              </details>

              <details v-if="selected.payments.length" class="mb-3">
                <summary class="cursor-pointer font-medium text-sm text-gray-700 dark:text-gray-300 select-none">
                  Paiements ({{ selected.payments.length }})
                </summary>
                <ul class="mt-2 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                  <li v-for="(p, i) in selected.payments" :key="i" class="flex justify-between py-1.5">
                    <span class="text-gray-700 dark:text-gray-300">
                      <span class="text-gray-400 text-xs mr-2">{{ p.date }}</span>
                      {{ p.method || "Paiement" }}
                      <span v-if="p.note" class="text-gray-400">— {{ p.note }}</span>
                    </span>
                    <span class="tabular-nums text-green-600">{{ Euro.format(p.amount) }}</span>
                  </li>
                </ul>
              </details>

              <details v-if="selected.invoices.length">
                <summary class="cursor-pointer font-medium text-sm text-gray-700 dark:text-gray-300 select-none">
                  Factures envoyées ({{ selected.invoices.length }})
                </summary>
                <ul class="mt-2 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                  <li v-for="(inv, i) in selected.invoices" :key="i" class="flex justify-between py-1.5">
                    <span class="text-gray-700 dark:text-gray-300">
                      <span class="text-gray-400 text-xs mr-2">{{ inv.date }}</span>
                      {{ inv.note || "Récap" }}
                    </span>
                    <span class="tabular-nums">{{ Euro.format(inv.amount) }}</span>
                  </li>
                </ul>
              </details>
            </template>
          </section>
        </div>
      </template>
    </main>

    <!-- Send recap modal -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="recapOpen"
          class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          @click.self="recapStep === 'sending' ? null : (recapOpen = false)"
        >
          <div class="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
              <h3 class="text-lg font-semibold">Récap trimestriel</h3>
              <p v-if="cutoffDisplay" class="text-sm text-gray-500 mt-1">
                Couvre la période depuis le <strong>{{ cutoffDisplay }}</strong>
              </p>
            </div>

            <!-- Step 1: select debtors -->
            <template v-if="recapStep === 'list'">
              <div class="flex items-center justify-between px-6 py-3 border-b border-gray-100 dark:border-gray-800 text-sm">
                <span class="text-gray-600 dark:text-gray-400">
                  {{ recapSendableCount }} adhérent(s) recevront un e-mail
                </span>
                <div class="space-x-2">
                  <button type="button" class="text-blue-600 hover:underline" @click="selectAllRecap">Tout cocher</button>
                  <button type="button" class="text-gray-500 hover:underline" @click="clearAllRecap">Tout décocher</button>
                </div>
              </div>
              <div class="flex-1 overflow-y-auto">
                <p v-if="!debtorsForRecap.length" class="p-6 text-center text-sm text-gray-500">
                  Aucun débiteur à signaler.
                </p>
                <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
                  <li v-for="p in debtorsForRecap" :key="p.name" class="flex items-center gap-3 px-6 py-2.5">
                    <input
                      type="checkbox"
                      :checked="recapSelected.has(p.name)"
                      :disabled="!p.email"
                      class="accent-blue-600"
                      @change="toggleRecapPlayer(p.name)"
                    />
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-gray-900 dark:text-white">{{ p.name }}</p>
                      <p class="text-xs text-gray-500 truncate">
                        {{ p.email || "— pas d'e-mail —" }}
                      </p>
                    </div>
                    <p class="text-sm font-semibold tabular-nums" :class="balanceClass(p.total)">
                      {{ Euro.format(p.total) }}
                    </p>
                    <button
                      type="button"
                      class="text-xs text-blue-600 hover:underline"
                      @click="openPreview(p.name)"
                    >
                      Aperçu
                    </button>
                  </li>
                </ul>
              </div>
              <p v-if="recapError" class="px-6 py-2 text-sm text-red-600">{{ recapError }}</p>
              <div class="px-6 py-3 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
                <button
                  type="button"
                  class="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                  @click="recapOpen = false"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  :disabled="recapSendableCount === 0"
                  class="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
                  @click="recapStep = 'confirm'"
                >
                  Suivant ({{ recapSendableCount }})
                </button>
              </div>
            </template>

            <!-- Step 2: confirmation -->
            <template v-else-if="recapStep === 'confirm'">
              <div class="p-6 flex-1">
                <p class="text-sm text-gray-700 dark:text-gray-300">
                  Cette action va envoyer <strong>{{ recapSendableCount }}</strong> e-mail(s) de récapitulatif.
                </p>
                <p class="text-sm text-gray-700 dark:text-gray-300 mt-3">
                  La <strong>date de coupure</strong> sera ensuite avancée à <strong>aujourd'hui</strong> dans la feuille <em>Data</em>,
                  pour que la prochaine période de facturation démarre à partir de cette date.
                </p>
                <p class="mt-4 text-xs text-gray-500">
                  Les adhérents sans e-mail ou sans dette ne recevront rien.
                </p>
              </div>
              <div class="px-6 py-3 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
                <button
                  type="button"
                  class="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                  @click="recapStep = 'list'"
                >
                  Retour
                </button>
                <button
                  type="button"
                  class="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  @click="confirmSendRecap"
                >
                  Confirmer l'envoi
                </button>
              </div>
            </template>

            <!-- Step 3: sending -->
            <template v-else-if="recapStep === 'sending'">
              <div class="p-12 text-center">
                <p class="text-sm text-gray-600">Envoi en cours…</p>
              </div>
            </template>

            <!-- Step 4: results -->
            <template v-else-if="recapStep === 'results' && recapResults">
              <div class="px-6 py-3 border-b border-gray-200 dark:border-gray-800 text-sm">
                <span class="text-green-600 font-medium">{{ recapResults.sentCount }} envoyé(s)</span>
                · <span class="text-gray-600">{{ recapResults.skippedCount }} ignoré(s)</span>
                · <span class="text-red-600">{{ recapResults.errorCount }} erreur(s)</span>
                <p v-if="recapResults.newCutoffDate" class="mt-1 text-xs text-blue-700">
                  Nouvelle date de coupure&nbsp;: <strong>{{ recapResults.newCutoffDate }}</strong>
                </p>
              </div>
              <div class="flex-1 overflow-y-auto">
                <ul class="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                  <li v-for="r in recapResults.results" :key="r.name" class="px-6 py-2 flex items-center gap-3">
                    <span class="w-5 text-center">
                      <span v-if="r.status === 'sent'" title="Envoyé">✅</span>
                      <span v-else-if="r.status === 'skipped'" title="Ignoré">➖</span>
                      <span v-else title="Erreur">❌</span>
                    </span>
                    <div class="flex-1 min-w-0">
                      <p class="font-medium truncate">{{ r.name }}</p>
                      <p class="text-xs text-gray-500 truncate">
                        {{ r.email || "—" }}<span v-if="r.reason"> · {{ r.reason }}</span>
                      </p>
                    </div>
                  </li>
                </ul>
              </div>
              <div class="px-6 py-3 border-t border-gray-200 dark:border-gray-800 flex justify-end">
                <button
                  type="button"
                  class="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  @click="recapOpen = false"
                >
                  Fermer
                </button>
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Preview slide-over -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="previewOpen"
          class="fixed inset-0 z-[60] bg-black/50 flex items-stretch justify-end"
          @click.self="previewOpen = false"
        >
          <div class="bg-white dark:bg-gray-900 w-full max-w-xl h-full flex flex-col shadow-xl">
            <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <h3 class="text-sm font-semibold">Aperçu — {{ previewForName }}</h3>
              <button type="button" class="text-gray-500 hover:text-gray-700" @click="previewOpen = false">
                ✕
              </button>
            </div>
            <div class="flex-1 overflow-hidden">
              <p v-if="previewLoading" class="p-6 text-sm text-gray-500">Chargement…</p>
              <p v-else-if="previewError" class="p-6 text-sm text-red-600">{{ previewError }}</p>
              <iframe
                v-else-if="previewHtml"
                :srcdoc="previewHtml"
                sandbox=""
                class="w-full h-full border-0 bg-white"
              ></iframe>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Payment modal -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="paymentOpen"
          class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          @click.self="paymentOpen = false"
        >
          <div class="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-6">
            <h3 class="text-lg font-semibold mb-1">Enregistrer un paiement</h3>
            <p class="text-sm text-gray-500 mb-4">{{ selected?.name }}</p>

            <form @submit.prevent="submitPayment" class="space-y-3">
              <div>
                <label class="block text-sm font-medium mb-1">Montant (€)</label>
                <input
                  v-model="paymentForm.montant"
                  type="number"
                  step="0.01"
                  required
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-md text-sm"
                />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Date</label>
                <input
                  v-model="paymentForm.date"
                  type="date"
                  required
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-md text-sm"
                />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Méthode</label>
                <select
                  v-model="paymentForm.methode"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-md text-sm"
                >
                  <option>Virement</option>
                  <option>Espèces</option>
                  <option>Chèque</option>
                  <option>Autre</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Note (optionnel)</label>
                <input
                  v-model="paymentForm.note"
                  type="text"
                  class="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-md text-sm"
                />
              </div>

              <p v-if="paymentError" class="text-sm text-red-600">{{ paymentError }}</p>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  class="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                  @click="paymentOpen = false"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  :disabled="paymentSubmitting"
                  class="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
                >
                  {{ paymentSubmitting ? "Enregistrement…" : "Enregistrer" }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
