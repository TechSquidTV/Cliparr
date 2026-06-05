import type { KeyboardEvent, RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utilities";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import {
  destructiveAlertClasses,
  iconButtonClasses,
  textInputClasses as inputClasses,
} from "@/components/ui/control-styles";
import { cliparrMotionTransitions } from "@/lib/motionPresets";
import type { MediaSource, ProviderSession } from "@/providers/types";
import { formatProviderName } from "@/components/providers/ProviderGlyph";
import SourceConnectPanel from "@/components/sources/SourceConnectPanel";
import type { Feedback, SourceFilter } from "@/components/sources/sourcesTypes";

function TooltipWrap({
  message,
  children,
}: {
  message: string | null;
  children: React.ReactElement;
}) {
  if (!message) {
    return children;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" tabIndex={0}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{message}</TooltipContent>
    </Tooltip>
  );
}

interface SourceCounts {
  all: number;
  enabled: number;
  disabled: number;
  attention: number;
}

const sourceFilterOptions = [
  ["all", "All"],
  ["enabled", "Enabled"],
  ["disabled", "Disabled"],
  ["attention", "Needs attention"],
] as const satisfies readonly [SourceFilter, string][];

function joinClassNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const sourcePrimaryButtonClasses =
  "inline-flex h-8 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-3 text-xs font-medium normal-case tracking-normal text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60";
const sourceSecondaryButtonClasses =
  "inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium normal-case tracking-normal text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";
const sourceDestructiveButtonClasses =
  "inline-flex h-8 items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 text-xs font-medium normal-case tracking-normal text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-60";
const sourceFieldLabelClasses =
  "text-ui-label font-normal normal-case tracking-normal text-muted-foreground";
const sourceMetaLabelClasses =
  "text-ui-micro font-normal normal-case tracking-normal text-muted-foreground";
const statusBadgeClasses =
  "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-ui-label font-medium normal-case tracking-normal";
const sourceFilterButtonClasses =
  "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-ui-label font-medium normal-case tracking-normal transition-colors";
const healthySurfaceClasses = "border-primary/30 bg-primary/10 text-foreground";
const attentionSurfaceClasses =
  "border-destructive/30 bg-destructive/10 text-destructive";
const secondarySurfaceClasses = "border-border bg-muted text-muted-foreground";
const SOURCE_STATE_INITIAL = {
  opacity: 0,
  y: 4,
  filter: "blur(6px)",
};
const SOURCE_STATE_VISIBLE = {
  opacity: 1,
  y: 0,
  filter: "blur(0px)",
};
const SOURCE_STATE_EXIT = {
  opacity: 0,
  y: -3,
  filter: "blur(6px)",
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Not checked yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceStatus(source: MediaSource) {
  if (!source.enabled) {
    return {
      label: "Disabled",
      className: "border-border bg-muted text-muted-foreground",
      icon: Server,
    };
  }

  if (source.lastError) {
    return {
      label: "Needs attention",
      className: attentionSurfaceClasses,
      icon: AlertTriangle,
    };
  }

  if (source.lastCheckedAt) {
    return {
      label: "Healthy",
      className: healthySurfaceClasses,
      icon: CheckCircle2,
    };
  }

  return {
    label: "Unchecked",
    className: secondarySurfaceClasses,
    icon: Globe,
  };
}

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
      className: attentionSurfaceClasses,
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
          <TooltipWrap message={reloadDisabledReason}>
            <button
              type="button"
              onClick={onReloadList}
              disabled={loading || reloading || refreshingAll}
              className={sourceSecondaryButtonClasses}
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4",
                  (reloading || loading) && "animate-spin",
                )}
              />
              Reload
            </button>
          </TooltipWrap>
          <TooltipWrap message={refreshAllDisabledReason}>
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
              <RefreshCw
                className={cn("h-4 w-4", refreshingAll && "animate-spin")}
              />
              Refresh All
            </button>
          </TooltipWrap>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source control"
            className={iconButtonClasses}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

interface SourcesDialogFiltersProperties {
  searchInputRef: RefObject<HTMLInputElement | null>;
  query: string;
  providerFilter: string;
  providerOptions: string[];
  statusFilter: SourceFilter;
  counts: SourceCounts;
  onQueryChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onStatusFilterChange: (value: SourceFilter) => void;
}

export function SourcesDialogFilters({
  searchInputRef,
  query,
  providerFilter,
  providerOptions,
  statusFilter,
  counts,
  onQueryChange,
  onProviderFilterChange,
  onStatusFilterChange,
}: SourcesDialogFiltersProperties) {
  return (
    <div className="border-b border-border bg-background px-4 py-3 sm:px-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-col gap-2 lg:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search by source name, URL, provider, or platform"
              className={cn(inputClasses, "pl-9")}
            />
          </label>

          <label className="flex h-9 items-center gap-3 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground">
            <span className={sourceFieldLabelClasses}>Provider</span>
            <select
              value={providerFilter}
              onChange={(event) => onProviderFilterChange(event.target.value)}
              className="h-full min-w-0 bg-transparent text-sm text-foreground outline-none"
            >
              <option value="all">All providers</option>
              {providerOptions.map((providerId) => (
                <option key={providerId} value={providerId}>
                  {formatProviderName(providerId)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-1 rounded-md border border-border bg-card p-1">
          {sourceFilterOptions.map(([value, label]) => {
            const isActive = statusFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onStatusFilterChange(value)}
                className={joinClassNames(
                  sourceFilterButtonClasses,
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {label}
                <span className="inline-block min-w-[3ch] text-right font-mono text-ui-micro tabular-nums opacity-80">
                  {counts[value]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface SourcesDialogAlertsProperties {
  error: string;
  feedback: Feedback | null;
}

export function SourcesDialogAlerts({
  error,
  feedback,
}: SourcesDialogAlertsProperties) {
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion
    ? { duration: 0 }
    : cliparrMotionTransitions.fast;

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {error && (
        <motion.div
          key="sources-error"
          layout={!reduceMotion}
          className={destructiveAlertClasses}
          data-sources-error-alert
          initial={reduceMotion ? { opacity: 1 } : SOURCE_STATE_INITIAL}
          animate={SOURCE_STATE_VISIBLE}
          exit={SOURCE_STATE_EXIT}
          transition={transition}
        >
          {error}
        </motion.div>
      )}

      {feedback && (
        <motion.div
          key={`sources-feedback-${feedback.tone}-${feedback.message}`}
          layout={!reduceMotion}
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            feedback.tone === "error" &&
              "border-destructive/30 bg-destructive/10 text-destructive",
            feedback.tone === "success" && healthySurfaceClasses,
            feedback.tone === "warning" && attentionSurfaceClasses,
          )}
          data-sources-feedback-alert
          initial={reduceMotion ? { opacity: 1 } : SOURCE_STATE_INITIAL}
          animate={SOURCE_STATE_VISIBLE}
          exit={SOURCE_STATE_EXIT}
          transition={transition}
        >
          {feedback.message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface SourcesConnectSectionProperties {
  forceAddSourceOpen: boolean;
  onClosePanel: () => void;
  onConnected: (session: ProviderSession) => Promise<void> | void;
}

export function SourcesConnectSection({
  forceAddSourceOpen,
  onClosePanel,
  onConnected,
}: SourcesConnectSectionProperties) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Connect another media server
            </h3>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Add a new Jellyfin server or reconnect another provider without
              leaving source management.
            </p>
          </div>
        </div>

        {!forceAddSourceOpen && (
          <button
            type="button"
            onClick={onClosePanel}
            className={sourceSecondaryButtonClasses}
          >
            <X className="h-4 w-4" />
            Close
          </button>
        )}
      </div>

      <div className="mt-4">
        <SourceConnectPanel
          onConnected={onConnected}
          onCancel={forceAddSourceOpen ? undefined : onClosePanel}
        />
      </div>
    </section>
  );
}

interface SourcesEmptyStateProperties {
  title: string;
  description: string;
}

export function SourcesEmptyState({
  title,
  description,
}: SourcesEmptyStateProperties) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card">
        <Server className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

interface SourceCardProperties {
  source: MediaSource;
  draftName: string;
  draftBaseUrl: string;
  busyAction?: string;
  refreshingAll: boolean;
  onDraftNameChange: (value: string) => void;
  onDraftBaseUrlChange: (value: string) => void;
  onSave: () => Promise<void> | void;
  onToggleEnabled: () => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  onRemove: () => Promise<void> | void;
}

export function SourceCard({
  source,
  draftName,
  draftBaseUrl,
  busyAction,
  refreshingAll,
  onDraftNameChange,
  onDraftBaseUrlChange,
  onSave,
  onToggleEnabled,
  onRefresh,
  onRemove,
}: SourceCardProperties) {
  const status = sourceStatus(source);
  const StatusIcon = status.icon;
  const trimmedName = draftName.trim();
  const trimmedBaseUrl = draftBaseUrl.trim();
  const isBusy = Boolean(busyAction) || refreshingAll;
  const canSaveEdits =
    Boolean(trimmedName) &&
    Boolean(trimmedBaseUrl) &&
    !isBusy &&
    (trimmedName !== source.name || trimmedBaseUrl !== source.baseUrl);
  let saveDisabledReason: string | null = null;
  if (isBusy) {
    saveDisabledReason = "Wait for the current action to finish.";
  } else if (!trimmedName) {
    saveDisabledReason = "Enter a display name.";
  } else if (!trimmedBaseUrl) {
    saveDisabledReason = "Enter a server URL.";
  } else if (trimmedName === source.name && trimmedBaseUrl === source.baseUrl) {
    saveDisabledReason = "No changes to save.";
  }
  const busyDisabledReason = isBusy
    ? "Wait for the current action to finish."
    : null;
  const product = stringValue(source.metadata.product);
  const platform = stringValue(source.metadata.platform);
  const reduceMotion = useReducedMotion();
  const stateTransition = reduceMotion
    ? { duration: 0 }
    : cliparrMotionTransitions.fast;

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !canSaveEdits) {
      return;
    }

    event.preventDefault();
    void onSave();
  }

  return (
    <article
      className={cn(
        "rounded-lg border p-4 transition-colors",
        source.enabled
          ? "border-border bg-background"
          : "border-border bg-muted/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <motion.span
            layout={!reduceMotion}
            className={joinClassNames(
              statusBadgeClasses,
              "border-border bg-card text-muted-foreground",
            )}
            transition={stateTransition}
          >
            {formatProviderName(source.providerId)}
          </motion.span>
          <motion.span
            layout={!reduceMotion}
            className={joinClassNames(
              statusBadgeClasses,
              "min-w-36 justify-center",
              status.className,
            )}
            transition={stateTransition}
          >
            <StatusIcon className="h-3.5 w-3.5" />
            {status.label}
          </motion.span>
          <AnimatePresence mode="popLayout" initial={false}>
            {busyAction && (
              <motion.span
                key="busy-action"
                layout={!reduceMotion}
                className={joinClassNames(
                  statusBadgeClasses,
                  "w-32 justify-center border-primary/30 bg-primary/10 text-primary",
                )}
                initial={reduceMotion ? { opacity: 1 } : SOURCE_STATE_INITIAL}
                animate={SOURCE_STATE_VISIBLE}
                exit={SOURCE_STATE_EXIT}
                transition={stateTransition}
              >
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                {busyAction}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>Checked {formatTimestamp(source.lastCheckedAt)}</div>
          <div>Updated {formatTimestamp(source.updatedAt)}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className={sourceFieldLabelClasses}>
          Display Name
          <input
            value={draftName}
            onChange={(event) => onDraftNameChange(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
            className={cn(inputClasses, "mt-1.5")}
          />
        </label>

        <label className={sourceFieldLabelClasses}>
          Server URL
          <input
            value={draftBaseUrl}
            onChange={(event) => onDraftBaseUrlChange(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
            className={cn(inputClasses, "mt-1.5")}
          />
        </label>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <dt className={sourceMetaLabelClasses}>Saved URL</dt>
          <dd className="mt-1 break-all text-xs font-medium text-foreground">
            {source.baseUrl}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <dt className={sourceMetaLabelClasses}>Details</dt>
          <dd className="mt-1 text-xs font-medium text-foreground">
            {[product, platform].filter(Boolean).join(" • ") ||
              "No extra metadata"}
          </dd>
        </div>
      </dl>

      <AnimatePresence initial={false}>
        {source.lastError && (
          <motion.div
            key="source-last-error"
            layout={!reduceMotion}
            className={cn(
              "mt-3 rounded-md border px-3 py-2 text-sm",
              attentionSurfaceClasses,
            )}
            initial={reduceMotion ? { opacity: 1 } : SOURCE_STATE_INITIAL}
            animate={SOURCE_STATE_VISIBLE}
            exit={SOURCE_STATE_EXIT}
            transition={stateTransition}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">Last check failed</div>
                <div className="mt-1">{source.lastError}</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-4 flex flex-wrap gap-2">
        <TooltipWrap message={canSaveEdits ? null : saveDisabledReason}>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!canSaveEdits}
            className={sourceSecondaryButtonClasses}
          >
            Save Changes
          </button>
        </TooltipWrap>
        <div
          className={joinClassNames(
            "inline-flex h-8 items-center gap-3 rounded-md border border-border bg-card px-3 text-xs font-medium normal-case tracking-normal text-foreground transition-opacity",
            isBusy && "opacity-60",
          )}
        >
          <span>{source.enabled ? "Enabled" : "Disabled"}</span>
          <TooltipWrap message={busyDisabledReason}>
            <Switch
              aria-label={`${source.enabled ? "Disable" : "Enable"} ${
                source.name
              }`}
              checked={source.enabled}
              disabled={isBusy}
              onCheckedChange={() => void onToggleEnabled()}
            />
          </TooltipWrap>
        </div>
        <TooltipWrap message={busyDisabledReason}>
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={isBusy}
            className={sourceSecondaryButtonClasses}
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                busyAction === "Refreshing..." && "animate-spin",
              )}
            />
            Refresh
          </button>
        </TooltipWrap>
        <TooltipWrap message={busyDisabledReason}>
          <button
            type="button"
            onClick={() => void onRemove()}
            disabled={isBusy}
            className={sourceDestructiveButtonClasses}
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </button>
        </TooltipWrap>
      </div>
    </article>
  );
}
