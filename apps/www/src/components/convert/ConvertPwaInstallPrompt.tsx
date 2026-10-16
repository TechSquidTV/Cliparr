import { buttonClassName } from "@cliparr/frontend/convert/ui";
import {
  createPwaInstallController,
  PwaInstallAction,
  type PwaInstallState,
  usePwaInstall,
} from "@cliparr/frontend/pwa";
import { Download, Share, Smartphone, X } from "lucide-react";

import {
  flushConvertMetrics,
  recordConvertPwaInstallAccepted,
  recordConvertPwaInstallClicked,
  recordConvertPwaInstallDismissed,
  recordConvertPwaInstalled,
  recordConvertPwaInstallPromptAvailable,
  recordConvertPwaInstallPromptShown,
} from "@/components/convert/convertMetrics";
const convertPwa = createPwaInstallController({
  dismissedKey: "cliparr-convert:pwa-install-dismissed",
  serviceWorkerUrl: "/convert/service-worker.js",
  serviceWorkerScope: "/convert/",
  recordMetric(event, input) {
    const recorders = {
      available: recordConvertPwaInstallPromptAvailable,
      installed: recordConvertPwaInstalled,
      shown: recordConvertPwaInstallPromptShown,
      clicked: recordConvertPwaInstallClicked,
      accepted: recordConvertPwaInstallAccepted,
      dismissed: recordConvertPwaInstallDismissed,
    };
    recorders[event](input);
    void flushConvertMetrics();
  },
});
convertPwa.start();
convertPwa.registerServiceWorker();

export interface ConvertPwaInstallPromptViewProps {
  state: PwaInstallState;
  prompting?: boolean;
  onDismiss: () => void;
  onInstall: () => void;
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
          data-tooltip="Install Cliparr Convert"
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
          data-tooltip="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
        <PwaInstallAction
          mode={state.mode}
          prompting={prompting}
          onInstall={onInstall}
          buttonClassName={buttonClassName({ size: "compact" })}
        />
      </div>
    </section>
  );
}

export function ConvertPwaInstallPrompt() {
  const { state, prompting, dismiss, install } = usePwaInstall(convertPwa);

  return (
    <ConvertPwaInstallPromptView
      state={state}
      prompting={prompting}
      onDismiss={dismiss}
      onInstall={() => void install()}
    />
  );
}
