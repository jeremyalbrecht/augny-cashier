// PWA install detection + incentive for the member page.
//
// "Is the user using the PWA" has two different answers, and they split by
// browser ENGINE, not by device:
//
//   isStandalone   → already launched from the Home Screen / Dock / installed
//                    app. Checked via matchMedia(display-mode: standalone)
//                    plus iOS Safari's non-standard `navigator.standalone`
//                    (same pair usePushNotifications checks).
//   canInstall     → Chromium-family browsers (Chrome/Edge — desktop, Android,
//                    or Mac) fire `beforeinstallprompt` when installable but
//                    not installed; captured here so a banner can trigger the
//                    native prompt on tap.
//   Safari, any OS → NEVER fires `beforeinstallprompt`. This is true on iOS
//                    *and* on macOS (Safari 17+/Sonoma+ supports "Add to
//                    Dock", but only via the manual Share/File menu — there
//                    is no programmatic prompt). So Safari is one bucket
//                    regardless of device, with manual instructions that
//                    differ only in wording (Share icon on iOS vs the Share
//                    menu / File > Add to Dock on Mac).
//
// Push notifications are the concrete reason to install on Safari (the API
// doesn't exist outside standalone mode), so the modal leans on that.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Per-session, not localStorage: this is the primary funnel into push (see
// usePushNotifications' own modal), so "not now" should mean "not this visit",
// not "never ask again" — mirrors the push modal's dismissal.
const DISMISS_KEY = "pwa-install-dismissed";

function isIOS(): boolean {
  // iPadOS 13+ reports as Macintosh, so check for touch as well.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** True for Safari on iOS or macOS — the browsers with no install prompt. */
function isSafari(): boolean {
  const ua = navigator.userAgent;
  if (isIOS()) return true;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
}

function isStandaloneNow(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function usePwaInstall() {
  const isStandalone = ref(false);
  const canInstall = ref(false);
  const dismissed = ref(false);
  const platform = ref<"ios" | "mac-safari" | "chromium" | "other">("other");

  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  function onBeforeInstallPrompt(e: Event) {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    canInstall.value = true;
  }

  function onAppInstalled() {
    canInstall.value = false;
    isStandalone.value = true;
    deferredPrompt = null;
  }

  async function promptInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    canInstall.value = false;
  }

  function dismiss() {
    dismissed.value = true;
    sessionStorage.setItem(DISMISS_KEY, "1");
  }

  onMounted(() => {
    isStandalone.value = isStandaloneNow();
    if (isIOS()) platform.value = "ios";
    else if (isSafari()) platform.value = "mac-safari";
    else platform.value = "chromium";
    dismissed.value = sessionStorage.getItem(DISMISS_KEY) === "1";

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
  });

  onUnmounted(() => {
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", onAppInstalled);
  });

  /**
   * Whether the incentive modal is worth showing at all: not already
   * installed, not dismissed this session, and either Safari (manual
   * instructions always apply) or Chromium with a captured prompt. Chromium
   * browsers that never fire the event (already installed some other way, or
   * genuinely unsupported) correctly get nothing.
   */
  const showModal = computed(() => {
    if (isStandalone.value || dismissed.value) return false;
    if (platform.value === "ios" || platform.value === "mac-safari") return true;
    return canInstall.value;
  });

  return { isStandalone, canInstall, platform, showModal, promptInstall, dismiss };
}
