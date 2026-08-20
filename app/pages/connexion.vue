<script setup lang="ts">
// Member sign-in. Two paths — Google for the roughly half of the roster with a
// Gmail address, magic link (e-mail OR licence number) for everyone else.
//
// The magic-link step deliberately never reveals whether the identifier matched
// anyone: the confirmation text is identical for a real member, an unknown
// input, and a member with no e-mail on file. See the server handler for why.

const { loggedIn, fetch: refreshSession } = useUserSession();
const route = useRoute();

// Already signed in? Nothing to do here.
watch(
  loggedIn,
  (v) => {
    if (v) navigateTo("/mon-compte");
  },
  { immediate: true },
);

const oauthFailed = computed(() => route.query.error === "oauth");
const linkExpired = computed(() => route.query.error === "lien-expire");

// --- Magic link ---
type Step = "identifier" | "code";
const step = ref<Step>("identifier");

const identifier = ref("");
const code = ref("");
const submitting = ref(false);
const codeError = ref<string | null>(null);
// A genuine transport/server failure — distinct from the endpoint's normal
// "ok" response, which it returns unconditionally by design (see the
// anti-enumeration contract in the server handler) whether or not an e-mail
// actually went out. This only fires when the request never got a real
// response at all, so it can't leak anything about the identifier.
const requestFailed = ref(false);

const RESEND_COOLDOWN_S = 60;
const cooldown = ref(0);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;

function startCooldown() {
  cooldown.value = RESEND_COOLDOWN_S;
  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0 && cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  }, 1000);
}
onBeforeUnmount(() => {
  if (cooldownTimer) clearInterval(cooldownTimer);
});

async function requestCode() {
  if (submitting.value || !identifier.value.trim()) return;
  submitting.value = true;
  codeError.value = null;
  requestFailed.value = false;
  try {
    // Resolves with the same body whatever the identifier resolved to — the
    // server never lets that outcome distinguish a response. A thrown error
    // here means the request never completed at all (network down, an
    // unrelated server crash), which is safe to surface: it says nothing
    // about the identifier, only that nothing happened yet.
    await $fetch("/api/member/magic/request", {
      method: "POST",
      body: { identifier: identifier.value.trim() },
    });
    step.value = "code";
    startCooldown();
  } catch {
    requestFailed.value = true;
  } finally {
    submitting.value = false;
  }
}

// The e-mail renders the code letter-spaced ("1 2 3 4 5 6") for readability,
// so a copy-paste carries spaces straight into the field. Strip everything
// but digits as the user types or pastes, rather than relying on maxlength
// (which truncates a pasted spaced code to its first few characters instead
// of collapsing it).
function onCodeInput(e: Event) {
  code.value = (e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 6);
}

async function submitCode() {
  if (submitting.value || code.value.trim().length < 6) return;
  submitting.value = true;
  codeError.value = null;
  try {
    await $fetch("/api/member/magic/verify", {
      method: "POST",
      body: { identifier: identifier.value.trim(), code: code.value.trim() },
    });
    await refreshSession();
    await navigateTo("/mon-compte");
  } catch (e: unknown) {
    codeError.value =
      (e as { statusMessage?: string })?.statusMessage ?? "Code invalide ou expiré";
  } finally {
    submitting.value = false;
  }
}

function backToIdentifier() {
  step.value = "identifier";
  code.value = "";
  codeError.value = null;
}

// --- Dev-only impersonation ---
// `import.meta.dev` is a compile-time constant, so in a production build this
// is `false &&  ...` and the whole block is tree-shaken out of the bundle.
const debugEnabled = import.meta.dev && useRuntimeConfig().public.debugAuth === true;
const debugEmail = ref("");
const debugError = ref<string | null>(null);

async function debugLogin() {
  if (!debugEmail.value.trim()) return;
  debugError.value = null;
  try {
    await $fetch("/api/member/debug-login", {
      method: "POST",
      body: { email: debugEmail.value.trim() },
    });
    await refreshSession();
    await navigateTo("/mon-compte");
  } catch (e: unknown) {
    debugError.value =
      (e as { statusMessage?: string })?.statusMessage ?? "Debug login indisponible";
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
    <header class="bg-[#0a1f44] text-white">
      <div class="max-w-screen-sm mx-auto px-4 py-4 flex items-center gap-3">
        <img src="~/assets/images/logo.png" class="w-10 brightness-0 invert" alt="Augny Badminton" />
        <div>
          <h1 class="text-lg font-semibold">Espace adhérent</h1>
          <p class="text-xs text-blue-100/70">Augny Badminton</p>
        </div>
      </div>
    </header>

    <main
      class="flex-1 max-w-screen-sm w-full mx-auto px-4 py-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))]"
    >
      <div
        v-if="oauthFailed"
        class="mb-5 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200"
      >
        La connexion Google a échoué. Es-tu sûr que l'email utilisé auprès de FFBad est bien l'email Google? Essaie plutôt d'entrer ton numéro de licence dans le champ ci-dessous.
      </div>
      <div
        v-if="linkExpired"
        class="mb-5 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-200"
      >
        Ce lien de connexion n'est plus valable. Demande-en un nouveau ci-dessous.
      </div>
      <div
        v-if="requestFailed"
        class="mb-5 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200"
      >
        La demande n'a pas pu être envoyée. Vérifie ta connexion et réessaie.
      </div>

      <div class="text-center mb-8">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Connexion</h2>
        <p class="text-gray-600 dark:text-gray-400 text-sm">
          Consulte ton solde, tes tournois et tes récapitulatifs.
        </p>
      </div>

      <!-- Step 1: Google, or ask for an identifier -->
      <template v-if="step === 'identifier'">
        <a
          href="/auth/google?state=member"
          class="w-full inline-flex items-center justify-center gap-3 px-6 py-3.5 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 font-medium text-gray-700"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.6 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.3 0-.6-.1-1.1-.2-1.6H12z" />
          </svg>
          Se connecter avec Google
        </a>

        <div class="flex items-center gap-3 my-6">
          <div class="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
          <span class="text-xs uppercase tracking-wide text-gray-400">ou</span>
          <div class="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
        </div>

        <form @submit.prevent="requestCode">
          <label for="identifier" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            E-mail ou numéro de licence
          </label>
          <input
            id="identifier"
            v-model="identifier"
            type="text"
            autocomplete="username"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            placeholder="prenom.nom@exemple.fr"
            class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-blue-500 focus:border-blue-500"
          >
          <button
            type="submit"
            :disabled="submitting || !identifier.trim()"
            class="mt-3 w-full px-6 py-3.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {{ submitting ? "Envoi…" : "Recevoir un code" }}
          </button>
        </form>

        <p class="text-xs text-gray-500 text-center mt-6">
          Utilise l'adresse ou la licence que le club a sur sa liste d'adhérents.
        </p>

        <!-- Dev only: compiled out of production builds entirely. -->
        <div
          v-if="debugEnabled"
          class="mt-8 p-4 rounded-lg border-2 border-dashed border-purple-400 bg-purple-50 dark:bg-purple-950/30"
        >
          <p class="text-xs font-semibold text-purple-800 dark:text-purple-300 mb-2">
            🐛 DEBUG — connexion sans vérification (dev uniquement)
          </p>
          <form class="flex gap-2" @submit.prevent="debugLogin">
            <input
              v-model="debugEmail"
              type="text"
              placeholder="nimporte@quoi.fr"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              class="flex-1 min-w-0 px-3 py-2 text-sm rounded-md border border-purple-300 dark:border-purple-700 bg-white dark:bg-gray-900"
            >
            <button
              type="submit"
              class="shrink-0 px-3 py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700"
            >
              Entrer
            </button>
          </form>
          <p v-if="debugError" class="mt-2 text-xs text-red-600 dark:text-red-400">
            {{ debugError }}
          </p>
        </div>
      </template>

      <!-- Step 2: enter the code -->
      <template v-else>
        <div
          class="px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-sm text-blue-900 dark:text-blue-200 mb-6"
        >
          Si ce compte existe, un e-mail vient d'être envoyé avec un code à 6 chiffres
          et un lien de connexion. Pense à vérifier tes spams.
        </div>

        <form @submit.prevent="submitCode">
          <label for="code" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Code à 6 chiffres
          </label>
          <input
            id="code"
            :value="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="000000"
            class="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-center text-2xl tracking-[0.4em] tabular-nums focus:ring-blue-500 focus:border-blue-500"
            @input="onCodeInput"
          >
          <p v-if="codeError" class="mt-2 text-sm text-red-600 dark:text-red-400">
            {{ codeError }}
          </p>
          <button
            type="submit"
            :disabled="submitting || code.trim().length < 6"
            class="mt-3 w-full px-6 py-3.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {{ submitting ? "Vérification…" : "Se connecter" }}
          </button>
        </form>

        <div class="flex items-center justify-between mt-5 text-sm">
          <button
            type="button"
            class="text-gray-500 hover:underline"
            @click="backToIdentifier"
          >
            ← Modifier
          </button>
          <button
            type="button"
            :disabled="cooldown > 0 || submitting"
            class="text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline"
            @click="requestCode"
          >
            {{ cooldown > 0 ? `Renvoyer dans ${cooldown}s` : "Renvoyer le code" }}
          </button>
        </div>
      </template>
    </main>
  </div>
</template>
