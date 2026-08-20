<script setup lang="ts">
import { parseSheetDate, type PlayerBalance } from "#server/utils/debts";

// Espace adhérent — a member's own view of what they owe.
//
// Mirrors the detail pane of /dettes rather than inventing a second visual
// language, but laid out single-column and mobile-first: this is read on a
// phone, usually from a link in the recap e-mail.
//
// An e-mail address is an ACCOUNT, not a person — parents commonly register
// themselves and their children under one address (7 such addresses in the
// live roster, one covering three players). So this page always renders a
// LIST of players. With one player it looks exactly like a personal page;
// with several it becomes a household view.

interface MeResponse {
  recognised: boolean;
  email: string;
  players?: PlayerBalance[];
  combinedTotal?: number;
  cutoffDate?: string | null;
}

const { loggedIn, clear } = useUserSession();

const me = ref<MeResponse | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);

const players = computed(() => me.value?.players ?? []);
const isHousehold = computed(() => players.value.length > 1);
const combinedTotal = computed(() => me.value?.combinedTotal ?? 0);
const cutoffDisplay = computed(() => isoToFR(me.value?.cutoffDate));

/**
 * Header subtitle. For a single player it's their name; for a household it's
 * the address itself.
 *
 * Deliberately NOT the first player: roster order does not identify the account
 * holder. In the live data one shared address lists the child first, so naming
 * them there would label the account with the wrong person.
 */
const accountLabel = computed(() => {
  if (isHousehold.value) return me.value?.email ?? "";
  return players.value[0]?.name ?? "Augny Badminton";
});

async function loadMe() {
  loading.value = true;
  loadError.value = null;
  try {
    me.value = await $fetch<MeResponse>("/api/member/me");
  } catch (e: unknown) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 401) {
      // Session expired underneath us — fall back to the signed-out view.
      me.value = null;
      await clear();
    } else {
      loadError.value =
        (e as { statusMessage?: string })?.statusMessage
        ?? (e as { message?: string })?.message
        ?? "Erreur inconnue";
    }
  } finally {
    loading.value = false;
  }
}

watch(
  loggedIn,
  (v) => {
    if (v) loadMe();
    else me.value = null;
  },
  { immediate: true },
);

async function doLogout() {
  await clear();
  me.value = null;
  await navigateTo("/connexion");
}

// Destructured so the refs auto-unwrap in the template (refs nested in a plain
// object returned from setup are not unwrapped).
const {
  state: pushState,
  subscribed: pushSubscribed,
  busy: pushBusy,
  error: pushError,
  toggle: togglePush,
} = usePushNotifications();

const {
  isStandalone,
  platform: pwaPlatform,
  showModal: showInstallModal,
  promptInstall,
  dismiss: dismissInstallModal,
} = usePwaInstall();

// Once the app is installed, push is the whole point of installing (there's
// no e-mail fallback — see CLAUDE.md "Web push"). A quiet toggle buried in a
// settings-looking card gets missed, so an installed-but-not-subscribed
// member gets a blocking modal instead. Dismissal is per-session (not
// localStorage): "not now" shouldn't mean "never ask again" for a channel
// that's the primary way reminders reach them.
const pushModalDismissed = ref(false);
const showPushModal = computed(
  () => isStandalone.value && pushState.value === "ready" && !pushSubscribed.value && !pushModalDismissed.value,
);

function dismissPushModal() {
  pushModalDismissed.value = true;
}

async function enablePushFromModal() {
  await togglePush();
  // Permission denied or the subscribe call failed: don't keep re-showing a
  // modal the member just said no to in the browser's own dialog.
  if (pushState.value !== "ready" || !pushSubscribed.value) dismissPushModal();
}

/**
 * A player with nothing outstanding is collapsed to a single line: their
 * existence is worth confirming (so a parent can see the child is accounted
 * for) but a breakdown of zeros is noise.
 *
 * Only an exact-ish zero counts. A player in credit has a negative total and
 * still gets full detail — being owed money is worth seeing itemised.
 */
function isSettled(p: PlayerBalance): boolean {
  return Math.abs(p.total) <= 0.01;
}

// --- Précédentes dettes ---
//
// One ledger per player combining the recaps the club invoiced (positive) with
// every payment made against them (negative), oldest first. Both source lists
// are unfiltered by the cutoff — `invoices` always was, and `allPayments` is
// the unfiltered counterpart of `payments` — so the lines genuinely sum to the
// net shown, which is `invoicesTotal − paymentsTotalAll`.
interface LedgerEntry {
  kind: "invoice" | "payment";
  label: string;
  date: string;
  /** Signed: invoices add, payments subtract. */
  amount: number;
  sortKey: number;
}

/** `DD/MM/YYYY` → sortable timestamp. Unparseable dates sort last rather than
 *  to the epoch, so a bad sheet value doesn't jump to the top of the ledger. */
function dateSortKey(date: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(date ?? "").trim());
  if (!m) return Number.MAX_SAFE_INTEGER;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
}

function previousDebts(p: PlayerBalance): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    ...p.invoices.map((inv) => ({
      kind: "invoice" as const,
      label: inv.note || "Récap trimestriel",
      date: inv.date,
      amount: inv.amount,
      sortKey: dateSortKey(inv.date),
    })),
    ...(p.allPayments ?? []).map((pay) => ({
      kind: "payment" as const,
      label: pay.method || "Paiement",
      date: pay.date,
      amount: -pay.amount,
      sortKey: dateSortKey(pay.date),
    })),
  ];
  return entries.sort((a, b) => a.sortKey - b.sortKey);
}

/** Net of the ledger above. Negative means credit on prior periods, which
 *  `outstandingFromInvoices` deliberately clamps away — hence not reusing it. */
function previousDebtsNet(p: PlayerBalance): number {
  return p.invoicesTotal - p.paymentsTotalAll;
}

// --- Achats / Tournois history (full season, two separate sections) ---
//
// `lines`/`tournaments` are cutoff-filtered (current period only); `allLines`/
// `allTournaments` are the same rows unfiltered, back to the start of the
// season. Each gets its own section (purchases and tournaments are different
// enough — item vs. result, single price vs. offered/originalDue — that
// merging them into one list reads worse than two clearly-labelled ones), but
// both share the same newest-first order, cutoff divider, and pagination.
type DividerRow = { kind: "divider" };
type PurchaseRow = { kind: "purchase"; date: string; item: string; price: number; sortKey: number | null };
type TournamentRow = {
  kind: "tournament";
  date: string;
  name: string;
  place?: string;
  due: number;
  originalDue: number;
  offered: boolean;
  win: boolean;
  finalist: boolean;
  sortKey: number | null;
};

/** Null for an unparseable date. Kept separate from a numeric fallback so the
 *  comparator below can sort these last regardless of sort direction. */
function dateKey(date: string): number | null {
  return parseSheetDate(date)?.getTime() ?? null;
}

/** Newest first, unparseable dates always last. */
function byDateDesc<T extends { sortKey: number | null }>(a: T, b: T): number {
  if (a.sortKey == null && b.sortKey == null) return 0;
  if (a.sortKey == null) return 1;
  if (b.sortKey == null) return -1;
  return b.sortKey - a.sortKey;
}

const cutoffTime = computed(() => {
  const iso = me.value?.cutoffDate;
  return iso ? new Date(iso).getTime() : null;
});

/** Sorts newest-first and inserts the cutoff divider right before the first
 *  record that's NOT current (older than the cutoff, or of unknown date) —
 *  or at the very end if every record is current. */
function withDivider<T extends { sortKey: number | null }>(entries: T[]): (T | DividerRow)[] {
  const sorted = [...entries].sort(byDateDesc);
  const cutoff = cutoffTime.value;
  if (cutoff == null || sorted.length === 0) return sorted;
  const idx = sorted.findIndex((e) => e.sortKey == null || e.sortKey < cutoff);
  const splitAt = idx === -1 ? sorted.length : idx;
  return [...sorted.slice(0, splitAt), { kind: "divider" as const }, ...sorted.slice(splitAt)];
}

function purchaseHistory(p: PlayerBalance): (PurchaseRow | DividerRow)[] {
  return withDivider(
    p.allLines.map((l) => ({
      kind: "purchase" as const,
      date: l.date,
      item: l.item,
      price: l.price,
      sortKey: dateKey(l.date),
    })),
  );
}

function tournamentHistory(p: PlayerBalance): (TournamentRow | DividerRow)[] {
  return withDivider(
    p.allTournaments.map((t) => ({
      kind: "tournament" as const,
      date: t.date,
      name: t.name,
      place: t.place,
      due: t.due,
      originalDue: t.originalDue,
      offered: t.offered,
      win: t.win,
      finalist: t.finalist,
      sortKey: dateKey(t.date),
    })),
  );
}

// Paginated 10-at-a-time, per player AND per section (a household can have
// several players, each with their own purchases/tournaments pagination). The
// divider counts as a row in the slice, so "10 items" can show as fewer than
// 10 real records right around the cutoff boundary — acceptable, it's a page
// size, not a guarantee.
const HISTORY_PAGE_SIZE = 10;
const historyLimits = ref<Record<string, number>>({});

function historyLimit(key: string): number {
  return historyLimits.value[key] ?? HISTORY_PAGE_SIZE;
}

function showMoreHistory(key: string) {
  historyLimits.value[key] = historyLimit(key) + HISTORY_PAGE_SIZE;
}

function visiblePurchases(p: PlayerBalance): (PurchaseRow | DividerRow)[] {
  return purchaseHistory(p).slice(0, historyLimit(`${p.name}:purchases`));
}

function hasMorePurchases(p: PlayerBalance): boolean {
  return purchaseHistory(p).length > historyLimit(`${p.name}:purchases`);
}

function visibleTournaments(p: PlayerBalance): (TournamentRow | DividerRow)[] {
  return tournamentHistory(p).slice(0, historyLimit(`${p.name}:tournaments`));
}

function hasMoreTournaments(p: PlayerBalance): boolean {
  return tournamentHistory(p).length > historyLimit(`${p.name}:tournaments`);
}

function hasDetail(p: PlayerBalance): boolean {
  return p.allLines.length > 0 || p.allTournaments.length > 0 || previousDebts(p).length > 0;
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-950">
    <header class="bg-[#0a1f44] text-white">
      <div class="max-w-screen-sm mx-auto px-4 py-4 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <img src="~/assets/images/logo.png" class="w-10 shrink-0 brightness-0 invert" alt="Augny Badminton" />
          <div class="min-w-0">
            <h1 class="text-lg font-semibold truncate">Mon compte</h1>
            <p class="text-xs text-blue-100/70 truncate">{{ accountLabel }}</p>
          </div>
        </div>
        <button
          v-if="loggedIn"
          type="button"
          class="shrink-0 text-sm px-3 py-1.5 rounded-md border border-white/20 hover:bg-white/10"
          @click="doLogout"
        >
          Déconnexion
        </button>
      </div>
    </header>

    <!-- Blocking install incentive. Mutually exclusive with the push modal
         below: this one only fires when NOT standalone, the push one only
         when standalone, so they never stack. Chromium gets a one-tap
         native prompt; Safari (iOS or Mac) gets manual steps, since
         beforeinstallprompt never fires there. -->
    <div
      v-if="showInstallModal"
      class="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
      @click.self="dismissInstallModal"
    >
      <div class="bg-white dark:bg-gray-900 rounded-xl w-full max-w-sm p-6 text-center shadow-xl">
        <p class="text-4xl mb-3">🏸</p>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Installe l'app Augny Badminton
        </h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-5">
          Ton solde en un tap depuis l'écran d'accueil, sans passer par ta boîte mail: pas de risque de louper les emails + un aperçu temps réel.
        </p>

        <button
          v-if="pwaPlatform === 'chromium'"
          type="button"
          class="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
          @click="promptInstall"
        >
          Installer l'app
        </button>

        <ol
          v-else-if="pwaPlatform === 'ios'"
          class="text-left text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 list-decimal list-inside space-y-1"
        >
          <li>Appuie sur <strong>Partager</strong> (l'icône ⬆️ en bas de Safari)</li>
          <li>Choisis <strong>Sur l'écran d'accueil</strong></li>
        </ol>

        <ol
          v-else-if="pwaPlatform === 'mac-safari'"
          class="text-left text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 list-decimal list-inside space-y-1"
        >
          <li>Menu <strong>Fichier</strong> → <strong>Ajouter au Dock…</strong></li>
        </ol>

        <button
          type="button"
          class="w-full mt-2 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          @click="dismissInstallModal"
        >
          Plus tard
        </button>
      </div>
    </div>

    <!-- Blocking install-time push incentive. Only reachable once the app is
         actually installed and push is technically available (state ready) —
         it does not fight with the needs-install / unsupported-ios copy in
         the card below, which covers members who haven't installed yet. -->
    <div
      v-if="showPushModal"
      class="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
      @click.self="dismissPushModal"
    >
      <div class="bg-white dark:bg-gray-900 rounded-xl w-full max-w-sm p-6 text-center shadow-xl">
        <p class="text-4xl mb-3">🔔</p>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Active les notifications
        </h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-5">
          Bénéficie d'un rappel sur ton téléphone quand le club envoie un récap, pour ne jamais louper un paiement.
        </p>
        <button
          type="button"
          :disabled="pushBusy"
          class="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
          @click="enablePushFromModal"
        >
          Activer les notifications
        </button>
        <button
          type="button"
          class="w-full mt-2 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          @click="dismissPushModal"
        >
          Plus tard
        </button>
        <p v-if="pushError" class="mt-3 text-xs text-red-600 dark:text-red-400">
          {{ pushError }}
        </p>
      </div>
    </div>

    <main class="max-w-screen-sm mx-auto px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <!-- 1. Not signed in -->
      <div v-if="!loggedIn" class="flex flex-col items-center justify-center py-24 gap-6 text-center">
        <div class="max-w-md">
          <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Espace adhérent</h2>
          <p class="text-gray-600 dark:text-gray-400">
            Connecte-toi pour consulter ton solde, tes tournois et tes récapitulatifs.
          </p>
        </div>
        <NuxtLink
          to="/connexion"
          class="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
        >
          Se connecter
        </NuxtLink>
      </div>

      <!-- 2. Loading -->
      <div v-else-if="loading && !me" class="py-24 text-center text-gray-500">
        Chargement…
      </div>

      <!-- 3. Signed in but not on the roster -->
      <div
        v-else-if="me && !me.recognised"
        class="flex flex-col items-center justify-center py-24 gap-4 text-center"
      >
        <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Adresse non reconnue</h2>
        <p class="text-gray-600 dark:text-gray-400 max-w-md">
          Tu es connecté avec <strong>{{ me.email }}</strong>, mais cette adresse n'est pas
          rattachée à un adhérent. Vérifie que l'adresse que tu as utilisée est bien celle qui est rattachée à ton compte FFBad.
        </p>
        <button
          type="button"
          class="text-sm px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          @click="doLogout"
        >
          Changer de compte
        </button>
      </div>

      <!-- 4. Error -->
      <div v-else-if="loadError" class="py-24 text-center">
        <p class="text-red-600 dark:text-red-400 mb-4">{{ loadError }}</p>
        <button
          type="button"
          class="text-sm px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          @click="loadMe"
        >
          Réessayer
        </button>
      </div>

      <!-- 5. The account -->
      <template v-else-if="players.length">
        <!-- Solde hero — the household total when the address covers several
             players, otherwise simply that player's solde. -->
        <section
          class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 text-center mb-4"
        >
          <p class="text-xs uppercase tracking-wide text-gray-500">
            {{ isHousehold ? "Solde total" : "Solde" }}
          </p>
          <p class="text-4xl font-semibold tabular-nums mt-1" :class="balanceClass(combinedTotal)">
            {{ Euro.format(combinedTotal) }}
          </p>
          <p class="text-sm text-gray-500 mt-1">
            <template v-if="combinedTotal > 0.01">à régler au club</template>
            <template v-else-if="combinedTotal < -0.01">en crédit — le club te doit</template>
            <template v-else>tout est à jour 🏸</template>
          </p>
          <p v-if="isHousehold" class="text-xs text-gray-500 mt-2">
            Pour {{ players.length }} adhérents rattachés à cette adresse
          </p>
        </section>

        <!-- Notifications (once for the account — the toggle is per-device) -->
        <section
          class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 mb-4"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="font-medium text-gray-900 dark:text-white text-sm">Notifications</h3>
              <p class="text-xs text-gray-500 mt-0.5">
                Reçois un rappel sur ton téléphone quand le club envoie un récap<template
                  v-if="isHousehold"
                > (pour tous les adhérents de cette adresse)</template>.
              </p>
            </div>
            <button
              v-if="pushState === 'ready'"
              type="button"
              role="switch"
              :aria-checked="pushSubscribed"
              :disabled="pushBusy"
              class="shrink-0 relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-50"
              :class="pushSubscribed ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700'"
              @click="togglePush()"
            >
              <span
                class="inline-block h-5 w-5 transform rounded-full bg-white transition-transform"
                :class="pushSubscribed ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>

          <p
            v-if="pushState === 'ready' && pushSubscribed"
            class="mt-3 text-xs text-green-700 dark:text-green-400"
          >
            ✅ Notifications activées sur cet appareil.
          </p>

          <!-- iOS Safari, not installed: requestPermission() does not exist
               until the page is on the Home Screen, so instructions beat a
               button that silently does nothing. -->
          <div
            v-else-if="pushState === 'needs-install'"
            class="mt-3 px-3 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-200"
          >
            <p class="font-medium mb-1">Sur iPhone, ajoute d'abord cette page à ton écran d'accueil&nbsp;:</p>
            <ol class="list-decimal list-inside space-y-0.5">
              <li>Appuie sur <strong>Partager</strong> (l'icône ⬆️ en bas de Safari)</li>
              <li>Choisis <strong>Sur l'écran d'accueil</strong></li>
              <li>Rouvre l'app depuis ton écran d'accueil, puis reviens ici</li>
            </ol>
          </div>

          <p v-else-if="pushState === 'unsupported-ios'" class="mt-3 text-xs text-gray-500">
            Sur iPhone, les notifications ne fonctionnent qu'avec <strong>Safari</strong>.
            Ouvre cette page dans Safari et ajoute-la à ton écran d'accueil.
          </p>

          <p v-else-if="pushState === 'denied'" class="mt-3 text-xs text-gray-500">
            Tu as refusé les notifications pour ce site. Pour les réactiver, autorise-les
            dans les réglages de ton navigateur.
          </p>

          <p v-else-if="pushState === 'unsupported'" class="mt-3 text-xs text-gray-500">
            Ton navigateur ne gère pas les notifications.
          </p>

          <p v-if="pushError" class="mt-2 text-xs text-red-600 dark:text-red-400">
            {{ pushError }}
          </p>
        </section>

        <!-- One card per player on the address -->
        <section
          v-for="p in players"
          :key="p.name"
          class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 mb-4"
        >
          <!-- Name + solde. Only shown for a household; on a solo account the
               hero above already says it. -->
          <div
            v-if="isHousehold"
            class="flex items-baseline justify-between gap-3"
            :class="isSettled(p) ? '' : 'mb-4 pb-3 border-b border-gray-100 dark:border-gray-800'"
          >
            <h3 class="font-semibold text-gray-900 dark:text-white truncate">{{ p.name }}</h3>
            <span class="tabular-nums font-semibold shrink-0" :class="balanceClass(p.total)">
              {{ Euro.format(p.total) }}
            </span>
          </div>

          <!-- Settled: acknowledge the player exists, then stop. A breakdown of
               zeros is noise, and the point is reassurance that they're
               accounted for. -->
          <p v-if="isSettled(p)" class="text-sm text-gray-500" :class="isHousehold ? 'mt-1' : ''">
            <template v-if="!isHousehold">{{ p.name }} — </template>✅ rien à régler, tout est à jour.
          </p>

          <template v-else>
            <!-- Breakdown -->
            <div class="grid grid-cols-3 text-sm text-gray-600 dark:text-gray-400 gap-2 text-center">
              <div>
                <p class="text-xs uppercase tracking-wide">Achats</p>
                <p class="tabular-nums font-medium">{{ Euro.format(p.purchasesTotal) }}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide">Tournois</p>
                <p class="tabular-nums font-medium">{{ Euro.format(p.tournamentsTotal) }}</p>
              </div>
              <div>
                <p class="text-xs uppercase tracking-wide">Paiements</p>
                <p class="tabular-nums font-medium">{{ Euro.format(p.paymentsTotal) }}</p>
              </div>
            </div>
            <p v-if="cutoffDisplay" class="text-xs text-gray-500 mt-3 text-center">
              Achats et tournois depuis le <strong>{{ cutoffDisplay }}</strong>
            </p>

            <!-- Unpaid invoices strip -->
            <div
              v-if="p.outstandingFromInvoices > 0.01"
              class="mt-4 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-sm"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="text-amber-900 dark:text-amber-200">
                  Non payé sur {{ p.unpaidInvoiceCount }} récap(s) déjà envoyé(s)
                </span>
                <span class="font-semibold tabular-nums text-amber-700 dark:text-amber-300 shrink-0">
                  {{ Euro.format(p.outstandingFromInvoices) }}
                </span>
              </div>
            </div>

            <!-- Details -->
            <div class="mt-4 space-y-3">
              <details v-if="p.allLines.length" open>
                <summary class="cursor-pointer font-medium text-sm text-gray-700 dark:text-gray-300 select-none py-1">
                  Achats ({{ p.allLines.length }})
                </summary>
                <ul class="mt-2 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                  <li v-for="(row, i) in visiblePurchases(p)" :key="i">
                    <div
                      v-if="row.kind === 'divider'"
                      class="flex items-center gap-2 py-2 text-xs font-medium text-blue-600 dark:text-blue-400"
                    >
                      <span class="h-px flex-1 bg-blue-200 dark:bg-blue-800" />
                      Dette actuelle à partir d'ici
                      <span class="h-px flex-1 bg-blue-200 dark:bg-blue-800" />
                    </div>
                    <div v-else class="flex justify-between gap-3 py-2">
                      <span class="text-gray-700 dark:text-gray-300 min-w-0">
                        <span class="text-gray-400 text-xs mr-2">{{ row.date }}</span>
                        {{ row.item }}
                      </span>
                      <span class="tabular-nums shrink-0" :class="row.price < 0 ? 'text-green-600' : ''">
                        {{ Euro.format(row.price) }}
                      </span>
                    </div>
                  </li>
                </ul>
                <button
                  v-if="hasMorePurchases(p)"
                  type="button"
                  class="mt-3 w-full py-2 text-sm text-blue-600 hover:underline"
                  @click="showMoreHistory(`${p.name}:purchases`)"
                >
                  Afficher plus
                </button>
              </details>

              <details v-if="p.allTournaments.length" open>
                <summary class="cursor-pointer font-medium text-sm text-gray-700 dark:text-gray-300 select-none py-1">
                  Tournois ({{ p.allTournaments.length }})
                </summary>
                <ul class="mt-2 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                  <li v-for="(row, i) in visibleTournaments(p)" :key="i">
                    <div
                      v-if="row.kind === 'divider'"
                      class="flex items-center gap-2 py-2 text-xs font-medium text-blue-600 dark:text-blue-400"
                    >
                      <span class="h-px flex-1 bg-blue-200 dark:bg-blue-800" />
                      Dette actuelle à partir d'ici
                      <span class="h-px flex-1 bg-blue-200 dark:bg-blue-800" />
                    </div>
                    <div v-else class="flex justify-between gap-3 py-2">
                      <span class="text-gray-700 dark:text-gray-300 min-w-0">
                        <span class="text-gray-400 text-xs mr-2">{{ row.date }}</span>
                        <span v-if="row.win" class="mr-1">🥇</span>
                        <span v-if="row.finalist" class="mr-1">🥈</span>
                        {{ row.name }}
                        <span v-if="row.place" class="text-gray-400 text-xs ml-1">{{ row.place }}</span>
                        <span v-if="row.offered" class="ml-1 text-xs text-green-600">🎁 offert</span>
                      </span>
                      <span class="tabular-nums shrink-0">
                        <span v-if="row.offered && row.originalDue > 0" class="text-gray-400 line-through mr-1">
                          {{ Euro.format(row.originalDue) }}
                        </span>
                        {{ Euro.format(row.due) }}
                      </span>
                    </div>
                  </li>
                </ul>
                <button
                  v-if="hasMoreTournaments(p)"
                  type="button"
                  class="mt-3 w-full py-2 text-sm text-blue-600 hover:underline"
                  @click="showMoreHistory(`${p.name}:tournaments`)"
                >
                  Afficher plus
                </button>
              </details>

              <details v-if="previousDebts(p).length">
                <summary class="cursor-pointer font-medium text-sm text-gray-700 dark:text-gray-300 select-none py-1">
                  <span class="inline-flex w-[calc(100%-1.5rem)] justify-between gap-3 align-middle">
                    <span>Précédentes dettes</span>
                    <span class="tabular-nums font-semibold" :class="balanceClass(previousDebtsNet(p))">
                      {{ Euro.format(previousDebtsNet(p)) }}
                    </span>
                  </span>
                </summary>
                <ul class="mt-2 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                  <li v-for="(e, i) in previousDebts(p)" :key="i" class="flex justify-between gap-3 py-2">
                    <span class="text-gray-700 dark:text-gray-300 min-w-0">
                      <span class="text-gray-400 text-xs mr-2">{{ e.date }}</span>
                      {{ e.label }}
                    </span>
                    <span
                      class="tabular-nums shrink-0"
                      :class="e.kind === 'payment' ? 'text-green-600 dark:text-green-400' : ''"
                    >
                      {{ Euro.format(e.amount) }}
                    </span>
                  </li>
                </ul>
                <div
                  class="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between gap-3 text-sm font-semibold"
                >
                  <span class="text-gray-700 dark:text-gray-300">Reste à régler</span>
                  <span class="tabular-nums" :class="balanceClass(previousDebtsNet(p))">
                    {{ Euro.format(previousDebtsNet(p)) }}
                  </span>
                </div>
              </details>

              <p v-if="!hasDetail(p)" class="text-sm text-gray-500 text-center py-2">
                Rien à afficher pour le moment.
              </p>
            </div>
          </template>
        </section>
      </template>
    </main>
  </div>
</template>
