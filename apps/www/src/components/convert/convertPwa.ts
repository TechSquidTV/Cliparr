import {
  flushConvertMetrics,
  recordConvertPwaInstallAccepted,
  recordConvertPwaInstallClicked,
  recordConvertPwaInstallDismissed,
  recordConvertPwaInstalled,
  recordConvertPwaInstallPromptAvailable,
  type ConvertPwaInstallFormFactor,
  type ConvertPwaInstallMetricInput,
} from "@/components/convert/convertMetrics";

const CONVERT_PWA_INSTALL_DISMISSED_KEY =
  "cliparr-convert:pwa-install-dismissed";
const CONVERT_PWA_SERVICE_WORKER_URL = "/convert/service-worker.js";
const CONVERT_PWA_SERVICE_WORKER_SCOPE = "/convert/";
export const CONVERT_MOBILE_INSTALL_MEDIA_QUERY = "(max-width: 639.98px)";
export const CONVERT_COARSE_POINTER_MEDIA_QUERY = "(pointer: coarse)";
export const CONVERT_STANDALONE_DISPLAY_MEDIA_QUERY =
  "(display-mode: standalone)";

type ConvertPwaInstallPromptMode = "hidden" | "ios" | "native";
type ConvertPwaInstallPromptListener = (
  installPrompt: BeforeInstallPromptEvent | null,
) => void;

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installPromptHandlingStarted = false;
let serviceWorkerRegistrationStarted = false;
let appInstalled = false;
let lastNativeInstallMetricInput: ConvertPwaInstallMetricInput | null = null;
const installPromptListeners = new Set<ConvertPwaInstallPromptListener>();

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice?: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt: () => Promise<void>;
}

export interface ConvertPwaInstallEnvironment {
  readonly appInstalled: boolean;
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

export interface ConvertPwaInstallState {
  readonly formFactor: ConvertPwaInstallFormFactor;
  readonly mode: ConvertPwaInstallPromptMode;
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

function metricInputForCurrentEnvironment(): ConvertPwaInstallMetricInput {
  return {
    formFactor:
      safeMatchMedia(CONVERT_MOBILE_INSTALL_MEDIA_QUERY) &&
      isMobilePwaDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0)
        ? "mobile"
        : "desktop",
    installMode: "native",
  };
}

function recordAndFlush(
  recorder: (input: ConvertPwaInstallMetricInput) => void,
  input: ConvertPwaInstallMetricInput,
) {
  recorder(input);
  void flushConvertMetrics();
}

export function getDeferredConvertPwaInstallPrompt() {
  return deferredInstallPrompt;
}

export function subscribeToConvertPwaInstallPrompt(
  listener: ConvertPwaInstallPromptListener,
) {
  listener(deferredInstallPrompt);
  installPromptListeners.add(listener);

  return () => {
    installPromptListeners.delete(listener);
  };
}

export function startConvertPwaInstallPromptHandling() {
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
    lastNativeInstallMetricInput = metricInputForCurrentEnvironment();
    recordAndFlush(
      recordConvertPwaInstallPromptAvailable,
      lastNativeInstallMetricInput,
    );
    notifyInstallPromptListeners();
  });

  browserWindow.addEventListener("appinstalled", () => {
    appInstalled = true;
    deferredInstallPrompt = null;
    recordAndFlush(
      recordConvertPwaInstalled,
      lastNativeInstallMetricInput ?? metricInputForCurrentEnvironment(),
    );
    notifyInstallPromptListeners();
  });
}

export function registerConvertServiceWorker(
  production = Boolean(import.meta.env?.PROD),
) {
  const browserWindow = globalThis.window;
  if (
    serviceWorkerRegistrationStarted ||
    !production ||
    browserWindow === undefined ||
    !browserWindow.isSecureContext ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  serviceWorkerRegistrationStarted = true;

  if (document.readyState === "complete") {
    registerConvertServiceWorkerNow();
    return;
  }

  browserWindow.addEventListener("load", registerConvertServiceWorkerNow, {
    once: true,
  });
}

function registerConvertServiceWorkerNow() {
  void navigator.serviceWorker
    .register(CONVERT_PWA_SERVICE_WORKER_URL, {
      scope: CONVERT_PWA_SERVICE_WORKER_SCOPE,
    })
    .then((registration) => registration.update().catch(() => {}))
    .catch(() => {});
}

export async function promptForConvertPwaInstall(
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

export function readConvertPwaInstallDismissed(storage = safeLocalStorage()) {
  return storage?.getItem(CONVERT_PWA_INSTALL_DISMISSED_KEY) === "true";
}

export function writeConvertPwaInstallDismissed(
  dismissed: boolean,
  storage = safeLocalStorage(),
) {
  if (!storage) {
    return;
  }

  if (dismissed) {
    storage.setItem(CONVERT_PWA_INSTALL_DISMISSED_KEY, "true");
    return;
  }

  storage.removeItem(CONVERT_PWA_INSTALL_DISMISSED_KEY);
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

function isStandalonePwa(environment: ConvertPwaInstallEnvironment) {
  return (
    environment.appInstalled ||
    environment.standaloneDisplayMode ||
    environment.navigatorStandalone
  );
}

function hiddenState(
  environment: ConvertPwaInstallEnvironment,
): ConvertPwaInstallState {
  return {
    formFactor:
      environment.mobileViewport &&
      isMobilePwaDevice(environment.userAgent, environment.maxTouchPoints)
        ? "mobile"
        : "desktop",
    mode: "hidden",
  };
}

export function resolveConvertPwaInstallState(
  environment: ConvertPwaInstallEnvironment,
): ConvertPwaInstallState {
  const isMobileDevice = isMobilePwaDevice(
    environment.userAgent,
    environment.maxTouchPoints,
  );
  const formFactor: ConvertPwaInstallFormFactor =
    environment.mobileViewport && isMobileDevice ? "mobile" : "desktop";

  if (
    environment.dismissed ||
    !environment.isSecureContext ||
    isStandalonePwa(environment)
  ) {
    return hiddenState(environment);
  }

  if (formFactor === "mobile") {
    if (environment.hasInstallPrompt) {
      return { formFactor, mode: "native" };
    }

    if (
      environment.coarsePointer &&
      isIosLikeDevice(environment.userAgent, environment.maxTouchPoints)
    ) {
      return { formFactor, mode: "ios" };
    }

    return { formFactor, mode: "hidden" };
  }

  return environment.hasInstallPrompt
    ? { formFactor, mode: "native" }
    : { formFactor, mode: "hidden" };
}

export function getConvertPwaInstallEnvironment(
  installPrompt: BeforeInstallPromptEvent | null,
): ConvertPwaInstallEnvironment {
  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  const browserWindow = globalThis.window;

  return {
    appInstalled,
    coarsePointer: safeMatchMedia(CONVERT_COARSE_POINTER_MEDIA_QUERY),
    dismissed: readConvertPwaInstallDismissed(),
    hasInstallPrompt: Boolean(installPrompt),
    isSecureContext: browserWindow.isSecureContext,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    mobileViewport: safeMatchMedia(CONVERT_MOBILE_INSTALL_MEDIA_QUERY),
    navigatorStandalone: navigatorWithStandalone.standalone === true,
    standaloneDisplayMode: safeMatchMedia(
      CONVERT_STANDALONE_DISPLAY_MEDIA_QUERY,
    ),
    userAgent: navigator.userAgent,
  };
}

export function metricInputForConvertPwaInstallState(
  state: ConvertPwaInstallState,
): ConvertPwaInstallMetricInput | null {
  return state.mode === "hidden"
    ? null
    : { formFactor: state.formFactor, installMode: state.mode };
}

export function recordConvertPwaInstallClick(
  input: ConvertPwaInstallMetricInput,
) {
  recordAndFlush(recordConvertPwaInstallClicked, input);
}

export function recordConvertPwaInstallAccept(
  input: ConvertPwaInstallMetricInput,
) {
  recordAndFlush(recordConvertPwaInstallAccepted, input);
}

export function recordConvertPwaInstallDismiss(
  input: ConvertPwaInstallMetricInput,
) {
  recordAndFlush(recordConvertPwaInstallDismissed, input);
}
