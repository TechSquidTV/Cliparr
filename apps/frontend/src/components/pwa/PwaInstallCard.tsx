import { Share, Smartphone } from "lucide-react";
import * as React from "react";

import { buttonClassName } from "#/components/ui/control-styles";
import { cn } from "#/lib/cn";
import { PwaInstallAction, type PwaInstallMode } from "#/pwa";

export function PwaInstallCard({
  mode,
  prompting = false,
  className,
  title,
  description,
  dismissControl,
  onInstall,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  mode: PwaInstallMode;
  prompting?: boolean;
  title: string;
  description: string;
  dismissControl: React.ReactNode;
  onInstall: () => void;
}) {
  if (mode === "hidden") {
    return null;
  }

  const isIosGuide = mode === "ios";
  const Icon = isIosGuide ? Share : Smartphone;

  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card p-3 text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs leading-5 text-muted-foreground">
            {isIosGuide
              ? "Use the browser Share menu, then Add to Home Screen."
              : description}
          </p>
        </div>
        {dismissControl}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
        <PwaInstallAction
          mode={mode}
          prompting={prompting}
          onInstall={onInstall}
          buttonClassName={buttonClassName({ size: "compact" })}
        />
      </div>
    </section>
  );
}
