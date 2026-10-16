import { Download, Share } from "lucide-react";
import { createElement, useCallback, useEffect, useRef, useState } from "react";

export const MOBILE_INSTALL_MEDIA_QUERY = "(max-width: 639.98px)";
export const COARSE_POINTER_MEDIA_QUERY = "(pointer: coarse)";
export const STANDALONE_DISPLAY_MEDIA_QUERY = "(display-mode: standalone)";
export type PwaInstallMode = "hidden" | "ios" | "native";
export interface PwaInstallState {
  readonly formFactor: "mobile" | "desktop";
  readonly mode: PwaInstallMode;
}
export interface PwaInstallMetricInput {
  formFactor: PwaInstallState["formFactor"];
  installMode: Exclude<PwaInstallMode, "hidden">;
}
export type PwaInstallMetric =
  "available" | "installed" | "shown" | "clicked" | "accepted" | "dismissed";
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice?: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt: () => Promise<void>;
}
export interface PwaInstallEnvironment {
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
interface PwaInstallOptions {
  dismissedKey: string;
  serviceWorkerUrl: string;
  serviceWorkerScope?: string;
  mobileOnly?: boolean;
  reloadOnUpdate?: boolean;
  recordMetric?: (
    event: PwaInstallMetric,
    input: PwaInstallMetricInput,
  ) => void;
}
function safeLocalStorage() {
  try {
    const storage = globalThis.localStorage;
    return typeof storage?.getItem === "function" ? storage : undefined;
  } catch {
    return;
  }
}
function matches(query: string) {
  return (
    typeof globalThis.window?.matchMedia === "function" &&
    window.matchMedia(query).matches
  );
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
export function resolvePwaInstallState(
  environment: PwaInstallEnvironment,
  mobileOnly = false,
): PwaInstallState {
  const formFactor =
    environment.mobileViewport &&
    isMobilePwaDevice(environment.userAgent, environment.maxTouchPoints)
      ? "mobile"
      : "desktop";
  let mode: PwaInstallMode = "hidden";
  if (
    !environment.dismissed &&
    environment.isSecureContext &&
    !environment.appInstalled &&
    !environment.standaloneDisplayMode &&
    !environment.navigatorStandalone &&
    (!mobileOnly || formFactor === "mobile")
  ) {
    if (environment.hasInstallPrompt) {
      mode = "native";
    } else if (
      formFactor === "mobile" &&
      environment.coarsePointer &&
      isIosLikeDevice(environment.userAgent, environment.maxTouchPoints)
    ) {
      mode = "ios";
    }
  }
  return { formFactor, mode };
}
export function metricInputForPwaInstallState(
  state: PwaInstallState,
): PwaInstallMetricInput | null {
  return state.mode === "hidden"
    ? null
    : { formFactor: state.formFactor, installMode: state.mode };
}
export async function promptForPwaInstall(
  installPrompt: BeforeInstallPromptEvent | null,
) {
  if (!installPrompt) {
    return null;
  }
  try {
    await installPrompt.prompt();
    return (await installPrompt.userChoice?.catch(() => null)) ?? null;
  } catch {
    return null;
  }
}
export function createPwaInstallController(options: PwaInstallOptions) {
  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let handlingStarted = false;
  let registrationStarted = false;
  let appInstalled = false;
  let dismissedInMemory = false;
  let lastNativeMetricInput: PwaInstallMetricInput | null = null;
  const listeners = new Set<() => void>();
  function notify() {
    for (const listener of listeners) {
      listener();
    }
  }
  function readDismissed(storage = safeLocalStorage()) {
    try {
      return (
        dismissedInMemory || storage?.getItem(options.dismissedKey) === "true"
      );
    } catch {
      return dismissedInMemory;
    }
  }
  function writeDismissed(dismissed: boolean, storage = safeLocalStorage()) {
    dismissedInMemory = dismissed;
    try {
      if (dismissed) {
        storage?.setItem(options.dismissedKey, "true");
      } else {
        storage?.removeItem(options.dismissedKey);
      }
    } catch {
      /* The in-memory state still dismisses this visit. */
    }
  }
  function getState(): PwaInstallState {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return { formFactor: "desktop", mode: "hidden" };
    }
    return resolvePwaInstallState(
      {
        appInstalled,
        coarsePointer: matches(COARSE_POINTER_MEDIA_QUERY),
        dismissed: readDismissed(),
        hasInstallPrompt: Boolean(deferredPrompt),
        isSecureContext: window.isSecureContext,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
        mobileViewport: matches(MOBILE_INSTALL_MEDIA_QUERY),
        navigatorStandalone:
          (navigator as Navigator & { readonly standalone?: boolean })
            .standalone === true,
        standaloneDisplayMode: matches(STANDALONE_DISPLAY_MEDIA_QUERY),
        userAgent: navigator.userAgent,
      },
      options.mobileOnly,
    );
  }
  function record(event: PwaInstallMetric, state = getState()) {
    const input = metricInputForPwaInstallState(state);
    if (input) {
      options.recordMetric?.(event, input);
    }
  }
  function currentNativeMetricInput(): PwaInstallMetricInput {
    return { formFactor: getState().formFactor, installMode: "native" };
  }
  function start() {
    if (
      handlingStarted ||
      typeof globalThis.window?.addEventListener !== "function"
    ) {
      return;
    }
    handlingStarted = true;
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredPrompt = event as BeforeInstallPromptEvent;
      lastNativeMetricInput = currentNativeMetricInput();
      options.recordMetric?.("available", lastNativeMetricInput);
      notify();
    });
    window.addEventListener("appinstalled", () => {
      appInstalled = true;
      deferredPrompt = null;
      options.recordMetric?.(
        "installed",
        lastNativeMetricInput ?? currentNativeMetricInput(),
      );
      notify();
    });
  }
  function registerServiceWorker(production = Boolean(import.meta.env?.PROD)) {
    if (
      registrationStarted ||
      !production ||
      typeof window === "undefined" ||
      !window.isSecureContext ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    registrationStarted = true;
    if (options.reloadOnUpdate) {
      let hasActiveController = Boolean(navigator.serviceWorker.controller);
      let reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hasActiveController) {
          hasActiveController = true;
          return;
        }
        if (!reloading) {
          reloading = true;
          window.location.reload();
        }
      });
    }
    const register = () => {
      void navigator.serviceWorker
        .register(options.serviceWorkerUrl, {
          scope: options.serviceWorkerScope,
        })
        .then((registration) => registration.update().catch(() => {}))
        .catch(() => {});
    };
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }
  return {
    start,
    registerServiceWorker,
    getState,
    readDismissed,
    writeDismissed,
    record,
    subscribe(listener: () => void) {
      listeners.add(listener);
      listener();
      return () => {
        listeners.delete(listener);
      };
    },
    dismiss() {
      record("dismissed");
      writeDismissed(true);
      notify();
    },
    async install() {
      const prompt = deferredPrompt;
      if (!prompt) {
        return;
      }
      const state = getState();
      record("clicked", state);
      try {
        const result = await promptForPwaInstall(prompt);
        if (result) {
          record(result.outcome, state);
          if (result.outcome === "dismissed") {
            writeDismissed(true);
          }
        }
      } finally {
        if (prompt === deferredPrompt) {
          deferredPrompt = null;
          notify();
        }
      }
    },
  };
}
export function usePwaInstall(
  controller: ReturnType<typeof createPwaInstallController>,
) {
  const [state, setState] = useState(controller.getState);
  const [prompting, setPrompting] = useState(false);
  const shownKeys = useRef(new Set<string>());
  useEffect(() => {
    controller.start();
    controller.registerServiceWorker();
    const refresh = () => setState(controller.getState());
    const unsubscribe = controller.subscribe(refresh);
    const cleanups = [
      MOBILE_INSTALL_MEDIA_QUERY,
      COARSE_POINTER_MEDIA_QUERY,
      STANDALONE_DISPLAY_MEDIA_QUERY,
    ].map((query) => {
      if (typeof globalThis.matchMedia !== "function") {
        return () => {};
      }
      const media = globalThis.matchMedia(query);
      media.addEventListener?.("change", refresh);
      return () => media.removeEventListener?.("change", refresh);
    });
    window.addEventListener("resize", refresh);
    window.addEventListener("orientationchange", refresh);
    return () => {
      unsubscribe();
      for (const cleanup of cleanups) {
        cleanup();
      }
      window.removeEventListener("resize", refresh);
      window.removeEventListener("orientationchange", refresh);
    };
  }, [controller]);
  useEffect(() => {
    if (state.mode === "hidden") {
      return;
    }
    const key = `${state.formFactor}:${state.mode}`;
    if (!shownKeys.current.has(key)) {
      shownKeys.current.add(key);
      controller.record("shown", state);
    }
  }, [controller, state]);
  const install = useCallback(async () => {
    setPrompting(true);
    try {
      await controller.install();
    } finally {
      setPrompting(false);
    }
  }, [controller]);
  const dismiss = useCallback(() => controller.dismiss(), [controller]);
  return { state, prompting, dismiss, install };
}
export function PwaInstallAction({
  mode,
  prompting,
  onInstall,
  buttonClassName,
}: {
  mode: Exclude<PwaInstallMode, "hidden">;
  prompting: boolean;
  onInstall: () => void;
  buttonClassName: string;
}) {
  return mode === "native"
    ? createElement(
        "button",
        {
          type: "button",
          onClick: onInstall,
          disabled: prompting,
          className: buttonClassName,
        },
        createElement(Download, { className: "h-4 w-4" }),
        prompting ? "Opening" : "Install",
      )
    : createElement(
        "span",
        {
          className:
            "inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-foreground",
        },
        createElement(Share, { className: "h-4 w-4" }),
        "Share",
      );
}
