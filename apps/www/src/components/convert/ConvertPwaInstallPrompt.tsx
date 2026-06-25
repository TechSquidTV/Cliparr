import { compactPrimaryButtonClasses } from "@cliparr/frontend/convert";
import { Download, Share, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  flushConvertMetrics,
  recordConvertPwaInstallPromptShown,
} from "@/components/convert/convertMetrics";
import {
  CONVERT_COARSE_POINTER_MEDIA_QUERY,
  CONVERT_MOBILE_INSTALL_MEDIA_QUERY,
  CONVERT_STANDALONE_DISPLAY_MEDIA_QUERY,
  getConvertPwaInstallEnvironment,
  getDeferredConvertPwaInstallPrompt,
  metricInputForConvertPwaInstallState,
  promptForConvertPwaInstall,
  readConvertPwaInstallDismissed,
  recordConvertPwaInstallAccept,
  recordConvertPwaInstallClick,
  recordConvertPwaInstallDismiss,
  registerConvertServiceWorker,
  resolveConvertPwaInstallState,
  startConvertPwaInstallPromptHandling,
  subscribeToConvertPwaInstallPrompt,
  writeConvertPwaInstallDismissed,
  type BeforeInstallPromptEvent,
  type ConvertPwaInstallState,
} from "@/components/convert/convertPwa";

startConvertPwaInstallPromptHandling();
registerConvertServiceWorker();

export interface ConvertPwaInstallPromptViewProps {
  state: ConvertPwaInstallState;
  prompting?: boolean;
  onDismiss: () => void;
  onInstall: () => void;
}

function addMediaQueryChangeListener(query: string, onChange: () => void) {
  if (
    globalThis.window === undefined ||
    typeof globalThis.matchMedia !== "function"
  ) {
    return () => {};
  }

  const mediaQuery = globalThis.matchMedia(query);
  if (
    typeof mediaQuery.addEventListener !== "function" ||
    typeof mediaQuery.removeEventListener !== "function"
  ) {
    return () => {};
  }

  const listener = () => onChange();
  mediaQuery.addEventListener("change", listener);
  return () => mediaQuery.removeEventListener("change", listener);
}

function getCurrentConvertPwaInstallState(
  installPrompt: BeforeInstallPromptEvent | null,
  dismissed: boolean,
): ConvertPwaInstallState {
  if (globalThis.window === undefined || typeof navigator === "undefined") {
    return { formFactor: "desktop", mode: "hidden" };
  }

  return resolveConvertPwaInstallState({
    ...getConvertPwaInstallEnvironment(installPrompt),
    dismissed,
  });
}

export function ConvertPwaInstallPromptView({
  state,
  prompting = false,
  onDismiss,
  onInstall,
}: ConvertPwaInstallPromptViewProps) {
  if (state.mode === "hidden") {
    return null;
  }

  if (state.formFactor === "desktop") {
    return (
      <div className="mt-5 hidden sm:flex">
        <button
          type="button"
          onClick={onInstall}
          disabled={prompting}
          className="focus-ring inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Install Cliparr Convert"
          title="Install Cliparr Convert"
          data-convert-pwa-install-mode="native"
          data-convert-pwa-form-factor="desktop"
        >
          <Download className="h-3.5 w-3.5" />
          {prompting ? "Opening" : "Install app"}
        </button>
      </div>
    );
  }

  const isIosGuide = state.mode === "ios";
  const Icon = isIosGuide ? Share : Smartphone;

  return (
    <section
      className="mt-5 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm sm:hidden"
      aria-label="Install Cliparr Convert"
      data-convert-pwa-install-mode={state.mode}
      data-convert-pwa-form-factor="mobile"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            Add Cliparr Convert to your home screen
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {isIosGuide
              ? "Use the browser Share menu, then Add to Home Screen."
              : "Install the converter for quick full-screen access and offline launches."}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Dismiss install prompt"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
        {state.mode === "native" ? (
          <button
            type="button"
            onClick={onInstall}
            disabled={prompting}
            className={compactPrimaryButtonClasses}
          >
            <Download className="h-4 w-4" />
            {prompting ? "Opening" : "Install"}
          </button>
        ) : (
          <span className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-foreground">
            <Share className="h-4 w-4" />
            Share
          </span>
        )}
      </div>
    </section>
  );
}

export function ConvertPwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(() =>
      getDeferredConvertPwaInstallPrompt(),
    );
  const [dismissed, setDismissed] = useState(() =>
    readConvertPwaInstallDismissed(),
  );
  const [state, setState] = useState<ConvertPwaInstallState>(() =>
    getCurrentConvertPwaInstallState(
      getDeferredConvertPwaInstallPrompt(),
      readConvertPwaInstallDismissed(),
    ),
  );
  const [prompting, setPrompting] = useState(false);
  const shownMetricKeys = useRef(new Set<string>());

  const refreshState = useCallback(
    (nextInstallPrompt = installPrompt, nextDismissed = dismissed) => {
      setState(
        getCurrentConvertPwaInstallState(nextInstallPrompt, nextDismissed),
      );
    },
    [dismissed, installPrompt],
  );

  useEffect(() => {
    startConvertPwaInstallPromptHandling();
    registerConvertServiceWorker();
  }, []);

  useEffect(() => {
    return subscribeToConvertPwaInstallPrompt((nextInstallPrompt) => {
      setInstallPrompt(nextInstallPrompt);
      refreshState(nextInstallPrompt);
    });
  }, [refreshState]);

  useEffect(() => {
    const refresh = () => refreshState();
    const cleanups = [
      addMediaQueryChangeListener(CONVERT_MOBILE_INSTALL_MEDIA_QUERY, refresh),
      addMediaQueryChangeListener(CONVERT_COARSE_POINTER_MEDIA_QUERY, refresh),
      addMediaQueryChangeListener(
        CONVERT_STANDALONE_DISPLAY_MEDIA_QUERY,
        refresh,
      ),
    ];

    window.addEventListener("resize", refresh);
    globalThis.addEventListener("orientationchange", refresh);

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
      window.removeEventListener("resize", refresh);
      globalThis.removeEventListener("orientationchange", refresh);
    };
  }, [refreshState]);

  useEffect(() => {
    const input = metricInputForConvertPwaInstallState(state);
    if (!input) {
      return;
    }

    const metricKey = `${input.formFactor}:${input.installMode}`;
    if (shownMetricKeys.current.has(metricKey)) {
      return;
    }

    shownMetricKeys.current.add(metricKey);
    recordConvertPwaInstallPromptShown(input);
    void flushConvertMetrics();
  }, [state]);

  const dismiss = useCallback(() => {
    const input = metricInputForConvertPwaInstallState(state);
    if (input) {
      recordConvertPwaInstallDismiss(input);
    }

    writeConvertPwaInstallDismissed(true);
    setDismissed(true);
    refreshState(installPrompt, true);
  }, [installPrompt, refreshState, state]);

  const install = useCallback(async () => {
    if (!installPrompt) {
      return;
    }

    const input = metricInputForConvertPwaInstallState(state);
    if (input) {
      recordConvertPwaInstallClick(input);
    }

    setPrompting(true);
    try {
      const result = await promptForConvertPwaInstall(installPrompt);
      setInstallPrompt(null);

      if (!result) {
        refreshState(null);
        return;
      }

      if (result.outcome === "accepted") {
        if (input) {
          recordConvertPwaInstallAccept(input);
        }
        refreshState(null);
        return;
      }

      if (input) {
        recordConvertPwaInstallDismiss(input);
      }
      writeConvertPwaInstallDismissed(true);
      setDismissed(true);
      refreshState(null, true);
    } finally {
      setPrompting(false);
    }
  }, [installPrompt, refreshState, state]);

  return (
    <ConvertPwaInstallPromptView
      state={state}
      prompting={prompting}
      onDismiss={dismiss}
      onInstall={() => void install()}
    />
  );
}
