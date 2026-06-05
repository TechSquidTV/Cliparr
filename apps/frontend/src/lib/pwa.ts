const PWA_INSTALL_DISMISSED_KEY = "cliparr:pwa-install-dismissed";
export const MOBILE_INSTALL_MEDIA_QUERY = "(max-width: 639.98px)";
export const COARSE_POINTER_MEDIA_QUERY = "(pointer: coarse)";
export const STANDALONE_DISPLAY_MEDIA_QUERY = "(display-mode: standalone)";

export type PwaInstallMode = "hidden" | "ios" | "native";
type PwaInstallPromptListener = (
  installPrompt: BeforeInstallPromptEvent | null,
) => void;

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installPromptHandlingStarted = false;
const installPromptListeners = new Set<PwaInstallPromptListener>();

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice?: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt: () => Promise<void>;
}

export interface PwaInstallEnvironment {
  readonly coarsePointer: boolean;
  readonly dismissed: boolean;
  readonly hasInstallPrompt: boolean;
  readonly isSecureContext: boolean;
  readonly maxTouchPoints: number;
  readonly mobileViewport: boolean;
  readonly navigatorStandalone: boolean;
  readonly standaloneDisplayMode: boolean;
  readonly userAgent: string;
}

interface NavigatorWithStandalone extends Navigator {
  readonly standalone?: boolean;
}

function safeLocalStorage() {
  try {
    const storage = globalThis.localStorage;
    return typeof storage?.getItem === "function" ? storage : undefined;
  } catch {
    return;
  }
}

function safeMatchMedia(query: string) {
  const browserWindow = globalThis.window;
  if (
    browserWindow === undefined ||
    typeof browserWindow.matchMedia !== "function"
  ) {
    return false;
  }

  return browserWindow.matchMedia(query).matches;
}

function notifyInstallPromptListeners() {
  for (const listener of installPromptListeners) {
    listener(deferredInstallPrompt);
  }
}

export function getDeferredPwaInstallPrompt() {
  return deferredInstallPrompt;
}

export function subscribeToPwaInstallPrompt(
  listener: PwaInstallPromptListener,
) {
  listener(deferredInstallPrompt);
  installPromptListeners.add(listener);

  return () => {
    installPromptListeners.delete(listener);
  };
}

export function startPwaInstallPromptHandling() {
  const browserWindow = globalThis.window;
  if (
    installPromptHandlingStarted ||
    browserWindow === undefined ||
    typeof browserWindow.addEventListener !== "function"
  ) {
    return;
  }

  installPromptHandlingStarted = true;

  browserWindow.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    notifyInstallPromptListeners();
  });

  browserWindow.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    notifyInstallPromptListeners();
  });
}

export async function promptForPwaInstall(
  installPrompt: BeforeInstallPromptEvent | null = deferredInstallPrompt,
) {
  if (!installPrompt) {
    return null;
  }

  try {
    await installPrompt.prompt();
    return (await installPrompt.userChoice?.catch(() => null)) ?? null;
  } catch {
    return null;
  } finally {
    if (installPrompt === deferredInstallPrompt) {
      deferredInstallPrompt = null;
      notifyInstallPromptListeners();
    }
  }
}

export function readPwaInstallDismissed(storage = safeLocalStorage()) {
  return storage?.getItem(PWA_INSTALL_DISMISSED_KEY) === "true";
}

export function writePwaInstallDismissed(
  dismissed: boolean,
  storage = safeLocalStorage(),
) {
  if (!storage) {
    return;
  }

  if (dismissed) {
    storage.setItem(PWA_INSTALL_DISMISSED_KEY, "true");
    return;
  }

  storage.removeItem(PWA_INSTALL_DISMISSED_KEY);
}

export function isIosLikeDevice(userAgent: string, maxTouchPoints: number) {
  return (
    /\b(ipad|iphone|ipod)\b/i.test(userAgent) ||
    (/\bmacintosh\b/i.test(userAgent) && maxTouchPoints > 1)
  );
}

function isMobilePwaDevice(userAgent: string, maxTouchPoints: number) {
  return (
    maxTouchPoints > 0 &&
    (/\b(android|webos|iphone|ipad|ipod|iemobile|opera mini)\b/i.test(
      userAgent,
    ) ||
      isIosLikeDevice(userAgent, maxTouchPoints))
  );
}

function isStandalonePwa(environment: PwaInstallEnvironment) {
  return environment.standaloneDisplayMode || environment.navigatorStandalone;
}

export function resolveMobilePwaInstallMode(
  environment: PwaInstallEnvironment,
): PwaInstallMode {
  if (
    environment.dismissed ||
    !environment.isSecureContext ||
    !environment.mobileViewport ||
    !isMobilePwaDevice(environment.userAgent, environment.maxTouchPoints) ||
    isStandalonePwa(environment)
  ) {
    return "hidden";
  }

  if (environment.hasInstallPrompt) {
    return "native";
  }

  if (
    environment.coarsePointer &&
    isIosLikeDevice(environment.userAgent, environment.maxTouchPoints)
  ) {
    return "ios";
  }

  return "hidden";
}

export function getPwaInstallEnvironment(
  installPrompt: BeforeInstallPromptEvent | null,
): PwaInstallEnvironment {
  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  const browserWindow = globalThis.window;

  return {
    coarsePointer: safeMatchMedia(COARSE_POINTER_MEDIA_QUERY),
    dismissed: readPwaInstallDismissed(),
    hasInstallPrompt: Boolean(installPrompt),
    isSecureContext: browserWindow.isSecureContext,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    mobileViewport: safeMatchMedia(MOBILE_INSTALL_MEDIA_QUERY),
    navigatorStandalone: navigatorWithStandalone.standalone === true,
    standaloneDisplayMode: safeMatchMedia(STANDALONE_DISPLAY_MEDIA_QUERY),
    userAgent: navigator.userAgent,
  };
}

export function registerCliparrServiceWorker(
  production = Boolean(import.meta.env?.PROD),
) {
  const browserWindow = globalThis.window;
  if (
    !production ||
    browserWindow === undefined ||
    !browserWindow.isSecureContext ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  let hasActiveController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hasActiveController) {
      hasActiveController = true;
      return;
    }

    if (reloading) {
      return;
    }

    reloading = true;
    browserWindow.location.reload();
  });

  browserWindow.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration) => registration.update().catch(() => {}))
      .catch(() => {});
  });
}
