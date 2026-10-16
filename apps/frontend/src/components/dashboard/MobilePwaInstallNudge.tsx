import { Share, Smartphone, X } from "lucide-react";

import {
  compactPrimaryButtonClasses,
  iconButtonClasses,
} from "@/components/ui/control-styles";
import { ControlTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { appPwa } from "@/lib/pwa";
import { PwaInstallAction, type PwaInstallMode, usePwaInstall } from "@/pwa";

export interface MobilePwaInstallNudgeCardProps {
  mode: PwaInstallMode;
  prompting?: boolean;
  className?: string;
  onDismiss: () => void;
  onInstall: () => void;
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
        <ControlTooltip label="Dismiss">
          <button
            type="button"
            onClick={onDismiss}
            className={cn(iconButtonClasses, "h-8 w-8 shrink-0")}
            aria-label="Dismiss install prompt"
          >
            <X className="h-4 w-4" />
          </button>
        </ControlTooltip>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
        <PwaInstallAction
          mode={mode}
          prompting={prompting}
          onInstall={onInstall}
          buttonClassName={compactPrimaryButtonClasses}
        />
      </div>
    </section>
  );
}

export function MobilePwaInstallNudge({ className }: { className?: string }) {
  const { state, prompting, dismiss, install } = usePwaInstall(appPwa);

  return (
    <MobilePwaInstallNudgeCard
      mode={state.mode}
      prompting={prompting}
      className={className}
      onDismiss={dismiss}
      onInstall={() => void install()}
    />
  );
}
