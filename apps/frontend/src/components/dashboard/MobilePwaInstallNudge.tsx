import { X } from "lucide-react";

import { PwaInstallCard } from "#/components/pwa/PwaInstallCard";
import { buttonClassName } from "#/components/ui/control-styles";
import { ControlTooltip } from "#/components/ui/tooltip";
import { cn } from "#/lib/cn";
import { appPwa } from "#/lib/pwa";
import { type PwaInstallMode, usePwaInstall } from "#/pwa";

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
  return (
    <PwaInstallCard
      mode={mode}
      prompting={prompting}
      className={cn("sm:hidden", className)}
      title="Add Cliparr to your home screen"
      description="Open it like an app with a faster, full-screen experience."
      aria-label="Install Cliparr"
      data-pwa-install-mode={mode}
      onInstall={onInstall}
      dismissControl={
        <ControlTooltip label="Dismiss">
          <button
            type="button"
            onClick={onDismiss}
            className={cn(
              buttonClassName({ tone: "icon", size: "icon" }),
              "h-8 w-8 shrink-0",
            )}
            aria-label="Dismiss install prompt"
          >
            <X className="h-4 w-4" />
          </button>
        </ControlTooltip>
      }
    />
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
