import type { KeyboardEvent, RefObject } from "react";
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
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import {
  compactPrimaryButtonClasses as primaryButtonClasses,
  compactSecondaryButtonClasses as secondaryButtonClasses,
  destructiveAlertClasses,
  destructiveButtonClasses,
  fieldLabelClasses as labelClasses,
  iconButtonClasses,
  textInputClasses as inputClasses,
} from "@/components/ui/controlClasses";
import type { MediaSource, ProviderSession } from "../../providers/types";
import { formatProviderName } from "../providers/ProviderGlyph";
import SourceConnectPanel from "./SourceConnectPanel";
import type { Feedback, SourceFilter } from "./sourcesTypes";

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

const statusBadgeClasses =
  "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-ui-label font-semibold uppercase tracking-[var(--tracking-caps-sm)]";
const healthySurfaceClasses = "border-primary/30 bg-primary/10 text-foreground";
const attentionSurfaceClasses =
  "border-destructive/30 bg-destructive/10 text-destructive";
const secondarySurfaceClasses = "border-border bg-muted text-muted-foreground";

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

interface SourcesDialogHeaderProps {
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
}: SourcesDialogHeaderProps) {
  const reloadDisabledReason =
    loading || reloading
      ? "Source list is already loading."
      : refreshingAll
        ? "Wait for refresh to finish."
        : null;
  const refreshAllDisabledReason =
    counts.all === 0
      ? "No sources to refresh."
      : hasBusyActions || refreshingAll
        ? "Wait for the current action to finish."
        : loading || reloading
          ? "Source list is still loading."
          : null;
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
              <h2 className="text-sm font-semibold uppercase tracking-[var(--tracking-caps-md)] text-foreground">
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
                  <span className="font-mono font-semibold tabular-nums text-foreground">
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
              className={secondaryButtonClasses}
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
              className={secondaryButtonClasses}
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
              className={primaryButtonClasses}
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

interface SourcesDialogFiltersProps {
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
}: SourcesDialogFiltersProps) {
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
            <span className="text-ui-label font-semibold uppercase tracking-[var(--tracking-caps-md)]">
              Provider
            </span>
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
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-ui-label font-semibold uppercase tracking-[var(--tracking-caps-sm)] transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {label}
                <span className="font-mono text-ui-micro opacity-80">
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

interface SourcesDialogAlertsProps {
  error: string;
  feedback: Feedback | null;
}

export function SourcesDialogAlerts({
  error,
  feedback,
}: SourcesDialogAlertsProps) {
  return (
    <>
      {error && <div className={destructiveAlertClasses}>{error}</div>}

      {feedback && (
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            feedback.tone === "error" &&
              "border-destructive/30 bg-destructive/10 text-destructive",
            feedback.tone === "success" && healthySurfaceClasses,
            feedback.tone === "warning" && attentionSurfaceClasses,
          )}
        >
          {feedback.message}
        </div>
      )}
    </>
  );
}

interface SourcesConnectSectionProps {
  forceAddSourceOpen: boolean;
  onClosePanel: () => void;
  onConnected: (session: ProviderSession) => Promise<void> | void;
}

export function SourcesConnectSection({
  forceAddSourceOpen,
  onClosePanel,
  onConnected,
}: SourcesConnectSectionProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[var(--tracking-caps-md)] text-foreground">
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
            className={secondaryButtonClasses}
          >
            <X className="h-4 w-4" />
            Close
          </button>
        )}
      </div>

      <div className="mt-4">
        <SourceConnectPanel
          onConnected={onConnected}
          onCancel={!forceAddSourceOpen ? onClosePanel : undefined}
        />
      </div>
    </section>
  );
}

interface SourcesEmptyStateProps {
  title: string;
  description: string;
}

export function SourcesEmptyState({
  title,
  description,
}: SourcesEmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card">
        <Server className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold uppercase tracking-[var(--tracking-caps-md)]">
        {title}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

interface SourceCardProps {
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
}: SourceCardProps) {
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
  const saveDisabledReason = isBusy
    ? "Wait for the current action to finish."
    : !trimmedName
      ? "Enter a display name."
      : !trimmedBaseUrl
        ? "Enter a server URL."
        : trimmedName === source.name && trimmedBaseUrl === source.baseUrl
          ? "No changes to save."
          : null;
  const busyDisabledReason = isBusy
    ? "Wait for the current action to finish."
    : null;
  const product = stringValue(source.metadata.product);
  const platform = stringValue(source.metadata.platform);

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
          <span
            className={cn(
              statusBadgeClasses,
              "border-border bg-card text-muted-foreground",
            )}
          >
            {formatProviderName(source.providerId)}
          </span>
          <span className={cn(statusBadgeClasses, status.className)}>
            <StatusIcon className="h-3.5 w-3.5" />
            {status.label}
          </span>
          {busyAction && (
            <span
              className={cn(
                statusBadgeClasses,
                "border-primary/30 bg-primary/10 text-primary",
              )}
            >
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {busyAction}
            </span>
          )}
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>Checked {formatTimestamp(source.lastCheckedAt)}</div>
          <div>Updated {formatTimestamp(source.updatedAt)}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className={labelClasses}>
          Display Name
          <input
            value={draftName}
            onChange={(event) => onDraftNameChange(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
            className={cn(inputClasses, "mt-1.5")}
          />
        </label>

        <label className={labelClasses}>
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
          <dt className="text-ui-micro font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
            Saved URL
          </dt>
          <dd className="mt-1 break-all text-xs font-medium text-foreground">
            {source.baseUrl}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <dt className="text-ui-micro font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
            Details
          </dt>
          <dd className="mt-1 text-xs font-medium text-foreground">
            {[product, platform].filter(Boolean).join(" • ") ||
              "No extra metadata"}
          </dd>
        </div>
      </dl>

      {source.lastError && (
        <div
          className={cn(
            "mt-3 rounded-md border px-3 py-2 text-sm",
            attentionSurfaceClasses,
          )}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">Last check failed</div>
              <div className="mt-1">{source.lastError}</div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <TooltipWrap message={!canSaveEdits ? saveDisabledReason : null}>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!canSaveEdits}
            className={secondaryButtonClasses}
          >
            Save Changes
          </button>
        </TooltipWrap>
        <div
          className={cn(
            "inline-flex h-8 items-center gap-3 rounded-md border border-border bg-card px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-foreground transition-opacity",
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
            className={secondaryButtonClasses}
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
            className={destructiveButtonClasses}
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </button>
        </TooltipWrap>
      </div>
    </article>
  );
}
