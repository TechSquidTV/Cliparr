import { Download, Share, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  COARSE_POINTER_MEDIA_QUERY,
  getDeferredPwaInstallPrompt,
  getPwaInstallEnvironment,
  MOBILE_INSTALL_MEDIA_QUERY,
  promptForPwaInstall,
  readPwaInstallDismissed,
  resolveMobilePwaInstallMode,
  STANDALONE_DISPLAY_MEDIA_QUERY,
  subscribeToPwaInstallPrompt,
  writePwaInstallDismissed,
  type BeforeInstallPromptEvent,
  type PwaInstallMode,
} from "@/lib/pwa";
import { cn } from "@/lib/utils";
import {
  compactPrimaryButtonClasses,
  iconButtonClasses,
} from "@/components/ui/control-styles";

export interface MobilePwaInstallNudgeCardProps {
  mode: PwaInstallMode;
  prompting?: boolean;
  className?: string;
  onDismiss: () => void;
  onInstall: () => void;
}

function addMediaQueryChangeListener(query: string, onChange: () => void) {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => undefined;
  }

  const mediaQuery = window.matchMedia(query);
  const listener = () => onChange();

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }

  mediaQuery.addListener(listener);
  return () => mediaQuery.removeListener(listener);
}

function getCurrentMobilePwaInstallMode(
  installPrompt: BeforeInstallPromptEvent | null,
  dismissed: boolean,
): PwaInstallMode {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "hidden";
  }

  return resolveMobilePwaInstallMode({
    ...getPwaInstallEnvironment(installPrompt),
    dismissed,
  });
}

export function MobilePwaInstallNudgeCard({
  mode,
  prompting = false,
  className,
  onDismiss,
  onInstall,
}: MobilePwaInstallNudgeCardProps) {
  if (mode === "hidden") {
    return null;
  }

  const isIosGuide = mode === "ios";
  const Icon = isIosGuide ? Share : Smartphone;

  return (
    <section
      className={cn(
        "sm:hidden rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm",
        className,
      )}
      aria-label="Install Cliparr"
      data-pwa-install-mode={mode}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-sm font-semibold text-foreground">
            Add Cliparr to your home screen
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {isIosGuide
              ? "Use the browser Share menu, then Add to Home Screen."
              : "Open it like an app with a faster, full-screen experience."}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className={cn(iconButtonClasses, "h-8 w-8 shrink-0")}
          aria-label="Dismiss install prompt"
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
        {mode === "native" ? (
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

export function MobilePwaInstallNudge({ className }: { className?: string }) {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(() =>
      getDeferredPwaInstallPrompt(),
    );
  const [dismissed, setDismissed] = useState(() => readPwaInstallDismissed());
  const [mode, setMode] = useState<PwaInstallMode>(() =>
    getCurrentMobilePwaInstallMode(
      getDeferredPwaInstallPrompt(),
      readPwaInstallDismissed(),
    ),
  );
  const [prompting, setPrompting] = useState(false);

  const refreshMode = useCallback(
    (nextInstallPrompt = installPrompt, nextDismissed = dismissed) => {
      setMode(getCurrentMobilePwaInstallMode(nextInstallPrompt, nextDismissed));
    },
    [dismissed, installPrompt],
  );

  useEffect(() => {
    return subscribeToPwaInstallPrompt((nextInstallPrompt) => {
      setInstallPrompt(nextInstallPrompt);
      refreshMode(nextInstallPrompt);
    });
  }, [refreshMode]);

  useEffect(() => {
    refreshMode();
  }, [refreshMode]);

  useEffect(() => {
    const refresh = () => refreshMode();
    const cleanups = [
      addMediaQueryChangeListener(MOBILE_INSTALL_MEDIA_QUERY, refresh),
      addMediaQueryChangeListener(COARSE_POINTER_MEDIA_QUERY, refresh),
      addMediaQueryChangeListener(STANDALONE_DISPLAY_MEDIA_QUERY, refresh),
    ];

    window.addEventListener("resize", refresh);
    window.addEventListener("orientationchange", refresh);

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
      window.removeEventListener("resize", refresh);
      window.removeEventListener("orientationchange", refresh);
    };
  }, [refreshMode]);

  const dismiss = useCallback(() => {
    writePwaInstallDismissed(true);
    setDismissed(true);
    refreshMode(installPrompt, true);
  }, [installPrompt, refreshMode]);

  const install = useCallback(async () => {
    if (!installPrompt) {
      return;
    }

    setPrompting(true);
    try {
      const result = await promptForPwaInstall(installPrompt);
      setInstallPrompt(null);
      if (!result) {
        refreshMode(null);
        return;
      }

      if (result.outcome !== "accepted") {
        writePwaInstallDismissed(true);
        setDismissed(true);
        refreshMode(null, true);
        return;
      }

      refreshMode(null);
    } finally {
      setPrompting(false);
    }
  }, [installPrompt, refreshMode]);

  return (
    <MobilePwaInstallNudgeCard
      mode={mode}
      prompting={prompting}
      className={className}
      onDismiss={dismiss}
      onInstall={() => void install()}
    />
  );
}
