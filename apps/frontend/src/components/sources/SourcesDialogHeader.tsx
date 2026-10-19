import { Plus, RefreshCw, Server, X } from "lucide-react";

import {
  healthySurfaceClasses,
  sourceSecondaryButtonClasses,
} from "#/components/sources/sourcesPresentation";
import type { SourceCounts } from "#/components/sources/sourcesTypes";
import {
  buttonClassName,
  warningSurfaceClasses,
} from "#/components/ui/control-styles";
import { Spinner } from "#/components/ui/spinner";
import { ControlTooltip } from "#/components/ui/tooltip";
import { cn } from "#/lib/cn";

const sourcePrimaryButtonClasses = buttonClassName({
  size: "compact",
  typography: "plain",
});
interface SourcesDialogHeaderProperties {
  counts: SourceCounts;
  forceAddSourceOpen: boolean;
  showConnectPanel: boolean;
  loading: boolean;
  reloading: boolean;
  refreshingAll: boolean;
  hasBusyActions: boolean;
  onToggleAddSource: () => void;
  onReloadList: () => void;
  onRefreshAll: () => void;
  onClose: () => void;
}

export function SourcesDialogHeader({
  counts,
  forceAddSourceOpen,
  showConnectPanel,
  loading,
  reloading,
  refreshingAll,
  hasBusyActions,
  onToggleAddSource,
  onReloadList,
  onRefreshAll,
  onClose,
}: SourcesDialogHeaderProperties) {
  let reloadDisabledReason: string | null = null;
  if (loading || reloading) {
    reloadDisabledReason = "Source list is already loading.";
  } else if (refreshingAll) {
    reloadDisabledReason = "Wait for refresh to finish.";
  }

  let refreshAllDisabledReason: string | null = null;
  if (counts.all === 0) {
    refreshAllDisabledReason = "No sources to refresh.";
  } else if (hasBusyActions || refreshingAll) {
    refreshAllDisabledReason = "Wait for the current action to finish.";
  } else if (loading || reloading) {
    refreshAllDisabledReason = "Source list is still loading.";
  }
  const headerMetrics = [
    {
      label: "Total",
      value: counts.all,
      className: "border-border bg-background",
    },
    {
      label: "Enabled",
      value: counts.enabled,
      className: healthySurfaceClasses,
    },
    {
      label: "Attention",
      value: counts.attention,
      className: warningSurfaceClasses,
    },
  ];

  return (
    <header className="border-b border-border bg-card px-4 py-3 sm:px-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <Server className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 space-y-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Source Control
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect servers, edit details, and run health checks.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {headerMetrics.map(({ label, value, className }) => (
                <div
                  key={label}
                  className={cn(
                    "inline-flex h-7 items-center gap-2 rounded-md border px-2.5 text-xs",
                    className,
                  )}
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="inline-block min-w-[3ch] text-right font-mono font-semibold tabular-nums text-foreground">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!forceAddSourceOpen && (
            <button
              type="button"
              onClick={onToggleAddSource}
              className={cn(sourceSecondaryButtonClasses, "w-28")}
            >
              <Plus
                className={cn(
                  "h-4 w-4 transition-transform",
                  showConnectPanel && "rotate-45",
                )}
              />
              {showConnectPanel ? "Hide" : "Add Source"}
            </button>
          )}
          <ControlTooltip disabled side="top" label={reloadDisabledReason}>
            <button
              type="button"
              onClick={onReloadList}
              disabled={loading || reloading || refreshingAll}
              className={sourceSecondaryButtonClasses}
            >
              {reloading || loading ? (
                <Spinner />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Reload
            </button>
          </ControlTooltip>
          <ControlTooltip disabled side="top" label={refreshAllDisabledReason}>
            <button
              type="button"
              onClick={onRefreshAll}
              disabled={
                loading ||
                reloading ||
                refreshingAll ||
                hasBusyActions ||
                counts.all === 0
              }
              className={sourcePrimaryButtonClasses}
            >
              {refreshingAll ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
              Refresh All
            </button>
          </ControlTooltip>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source control"
            className={buttonClassName({ tone: "icon", size: "icon" })}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
