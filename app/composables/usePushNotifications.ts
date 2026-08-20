// Web push opt-in for the member page.
//
// The interesting part is `state`, which distinguishes *why* push isn't
// available so the UI can say something useful instead of showing a dead
// toggle:
//
//   ready            → Android / desktop, or an installed iOS PWA. Show a toggle.
//   needs-install    → iOS Safari, not launched from the Home Screen. The push
//                      API genuinely does not exist yet; show install steps.
//   unsupported-ios  → Chrome/Firefox on iOS. They're Safari underneath with no
//                      push at all; tell them to use Safari.
//   unsupported      → anything else without a PushManager.
//   denied           → permission was refused; only the browser settings can
//                      undo it, so say so rather than re-prompting forever.

export type PushState =
  | "loading"
  | "ready"
  | "needs-install"
  | "unsupported-ios"
  | "unsupported"
  | "denied";

/** Web Push wants the VAPID key as a Uint8Array, not the base64url string. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIOS(): boolean {
  // iPadOS 13+ reports as Macintosh, so check for touch as well.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches
    // Safari's non-standard flag, still the reliable signal on iOS.
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function usePushNotifications() {
  const config = useRuntimeConfig();
  const state = ref<PushState>("loading");
  const subscribed = ref(false);
  const busy = ref(false);
  const error = ref<string | null>(null);

  let registration: ServiceWorkerRegistration | null = null;

  async function init() {
    if (!import.meta.client) return;

    const hasPush = "serviceWorker" in navigator && "PushManager" in window;

    if (!hasPush) {
      if (isIOS()) {
        // On iOS the API is missing for two very different reasons.
        state.value = isStandalone() ? "unsupported-ios" : "needs-install";
      } else {
        state.value = "unsupported";
      }
      return;
    }

    if (Notification.permission === "denied") {
      state.value = "denied";
      return;
    }

    try {
      registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      subscribed.value = existing !== null;
      state.value = "ready";
    } catch (e) {
      console.error("[push] service worker registration failed:", e);
      state.value = "unsupported";
    }
  }

  async function subscribe() {
    if (busy.value || !registration) return;
    busy.value = true;
    error.value = null;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        state.value = permission === "denied" ? "denied" : "ready";
        return;
      }

      const vapidKey = config.public.vapidPublicKey as string;
      if (!vapidKey) {
        error.value = "Notifications non configurées côté serveur.";
        return;
      }

      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      await $fetch("/api/member/push/subscribe", {
        method: "POST",
        body: sub.toJSON(),
      });
      subscribed.value = true;
    } catch (e: unknown) {
      console.error("[push] subscribe failed:", e);
      error.value = "Impossible d'activer les notifications.";
    } finally {
      busy.value = false;
    }
  }

  async function unsubscribe() {
    if (busy.value || !registration) return;
    busy.value = true;
    error.value = null;
    try {
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        // Tell the server first: if the local unsubscribe succeeded but the
        // server call didn't, we'd keep pushing to a dead endpoint until the
        // 410-prune catches it.
        await $fetch("/api/member/push/unsubscribe", {
          method: "POST",
          body: { endpoint: sub.endpoint },
        }).catch(() => {});
        await sub.unsubscribe();
      }
      subscribed.value = false;
    } catch (e: unknown) {
      console.error("[push] unsubscribe failed:", e);
      error.value = "Impossible de désactiver les notifications.";
    } finally {
      busy.value = false;
    }
  }

  async function toggle() {
    if (subscribed.value) await unsubscribe();
    else await subscribe();
  }

  onMounted(init);

  return { state, subscribed, busy, error, toggle, subscribe, unsubscribe };
}
