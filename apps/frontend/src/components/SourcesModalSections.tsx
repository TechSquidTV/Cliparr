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
import { cn } from "../lib/utils";
import type { MediaSource, ProviderSession } from "../providers/types";
import { formatProviderName } from "./ProviderGlyph";
import SourceConnectPanel from "./SourceConnectPanel";

export type SourceFilter = "all" | "enabled" | "disabled" | "attention";

export interface Feedback {
  tone: "error" | "success" | "warning";
  message: string;
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

const healthySurfaceClasses =
  "border-[color:color-mix(in_oklch,var(--primary)_24%,transparent)] bg-[color:color-mix(in_oklch,var(--primary)_12%,var(--background))] text-[color:color-mix(in_oklch,var(--primary)_78%,var(--foreground))]";
const attentionSurfaceClasses =
  "border-[color:color-mix(in_oklch,var(--destructive)_24%,transparent)] bg-[color:color-mix(in_oklch,var(--destructive)_12%,var(--background))] text-[color:color-mix(in_oklch,var(--destructive)_72%,var(--foreground))]";
const secondarySurfaceClasses =
  "border-[color:color-mix(in_oklch,var(--secondary)_24%,transparent)] bg-[color:color-mix(in_oklch,var(--secondary)_12%,var(--background))] text-[color:color-mix(in_oklch,var(--secondary)_64%,var(--foreground))]";
const elevatedGlassClasses =
  "border-[color:color-mix(in_oklch,var(--foreground)_10%,transparent)] bg-[color:color-mix(in_oklch,var(--card)_72%,transparent)]";

export function compareStrings(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

export function stringValue(value: unknown) {
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

export function sortSources(sources: MediaSource[]) {
  return [...sources].sort((left, right) =>
    compareStrings(formatProviderName(left.providerId), formatProviderName(right.providerId))
    || compareStrings(left.name, right.name)
    || compareStrings(left.id, right.id)
  );
}

interface SourcesModalHeaderProps {
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

export function SourcesModalHeader({
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
}: SourcesModalHeaderProps) {
  return (
    <header className="border-b border-border bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_55%),linear-gradient(180deg,color-mix(in_oklch,var(--muted)_82%,var(--card)),var(--card))] px-5 py-5 sm:px-8 sm:py-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[var(--tracking-caps-xl)] text-muted-foreground", elevatedGlassClasses)}>
            <Server className="h-3.5 w-3.5" />
            Source Control
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Manage Sources</h2>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              Connect new servers, update saved source details, run health checks, and clean up anything you no longer want Cliparr to query.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <div className="rounded-2xl border border-border bg-background/70 px-4 py-3">
              <div className="text-muted-foreground">Total</div>
              <div className="text-lg font-semibold">{counts.all}</div>
            </div>
            <div className={cn("rounded-2xl border px-4 py-3", healthySurfaceClasses)}>
              <div className="opacity-80">Enabled</div>
              <div className="text-lg font-semibold">{counts.enabled}</div>
            </div>
            <div className={cn("rounded-2xl border px-4 py-3", attentionSurfaceClasses)}>
              <div className="opacity-80">Needs Attention</div>
              <div className="text-lg font-semibold">{counts.attention}</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!forceAddSourceOpen && (
            <button
              type="button"
              onClick={onToggleAddSource}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/80 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className={cn("h-4 w-4 transition-transform", showConnectPanel && "rotate-45")} />
              {showConnectPanel ? "Hide Add Source" : "Add Source"}
            </button>
          )}
          <button
            type="button"
            onClick={onReloadList}
            disabled={loading || reloading || refreshingAll}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/80 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={cn("h-4 w-4", (reloading || loading) && "animate-spin")} />
            Reload List
          </button>
          <button
            type="button"
            onClick={onRefreshAll}
            disabled={loading || reloading || refreshingAll || hasBusyActions || counts.all === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={cn("h-4 w-4", refreshingAll && "animate-spin")} />
            Refresh All
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/80 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
            Close
          </button>
        </div>
      </div>
    </header>
  );
}

interface SourcesModalFiltersProps {
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

export function SourcesModalFilters({
  searchInputRef,
  query,
  providerFilter,
  providerOptions,
  statusFilter,
  counts,
  onQueryChange,
  onProviderFilterChange,
  onStatusFilterChange,
}: SourcesModalFiltersProps) {
  return (
    <div className="border-b border-border px-5 py-4 sm:px-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-col gap-3 lg:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search by source name, URL, provider, or platform"
              className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-4 text-sm outline-none transition-colors focus:border-ring"
            />
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-input bg-background px-4 text-sm text-muted-foreground">
            <span>Provider</span>
            <select
              value={providerFilter}
              onChange={(event) => onProviderFilterChange(event.target.value)}
              className="h-11 bg-transparent text-foreground outline-none"
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

        <div className="flex flex-wrap gap-2">
          {sourceFilterOptions.map(([value, label]) => {
            const isActive = statusFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onStatusFilterChange(value)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {label}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    isActive
                      ? "bg-[color-mix(in_oklch,var(--primary-foreground)_16%,transparent)] text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}
                >
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

interface SourcesModalAlertsProps {
  error: string;
  feedback: Feedback | null;
}

export function SourcesModalAlerts({ error, feedback }: SourcesModalAlertsProps) {
  return (
    <>
      {error && (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {feedback && (
        <div
          className={cn(
            "rounded-2xl border px-4 py-3 text-sm",
            feedback.tone === "error" && "border-destructive/20 bg-destructive/10 text-destructive",
            feedback.tone === "success" && healthySurfaceClasses,
            feedback.tone === "warning" && attentionSurfaceClasses
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
    <section className="rounded-[var(--radius-panel)] border border-border bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_10%,transparent),transparent_52%),linear-gradient(180deg,color-mix(in_oklch,var(--muted)_78%,var(--background)),var(--background))] p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[var(--tracking-caps-xl)] text-muted-foreground", elevatedGlassClasses)}>
            <Plus className="h-3.5 w-3.5" />
            Add Source
          </div>
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">Connect another media server</h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Add a new Jellyfin server or reconnect another provider without leaving source management.
            </p>
          </div>
        </div>

        {!forceAddSourceOpen && (
          <button
            type="button"
            onClick={onClosePanel}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <X className="h-4 w-4" />
            Close Panel
          </button>
        )}
      </div>

      <div className="mt-5">
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

export function SourcesEmptyState({ title, description }: SourcesEmptyStateProps) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-dashed border-border bg-background/60 px-8 py-14 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Server className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
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
  const canSaveEdits = Boolean(trimmedName)
    && Boolean(trimmedBaseUrl)
    && !isBusy
    && (trimmedName !== source.name || trimmedBaseUrl !== source.baseUrl);
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
        "rounded-[var(--radius-panel)] border p-5 shadow-sm transition-colors",
        source.enabled
          ? "border-border bg-background/90"
          : "border-border bg-muted/40"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-[var(--tracking-caps-xl)] text-muted-foreground">
            {formatProviderName(source.providerId)}
          </span>
          <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium", status.className)}>
            <StatusIcon className="h-3.5 w-3.5" />
            {status.label}
          </span>
          {busyAction && (
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
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
        <label className="block text-xs font-medium uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
          Display Name
          <input
            value={draftName}
            onChange={(event) => onDraftNameChange(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
            className="mt-2 h-11 w-full rounded-xl border border-input bg-card px-4 text-sm text-foreground outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <label className="block text-xs font-medium uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
          Server URL
          <input
            value={draftBaseUrl}
            onChange={(event) => onDraftBaseUrlChange(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
            className="mt-2 h-11 w-full rounded-xl border border-input bg-card px-4 text-sm text-foreground outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card/80 px-4 py-3">
          <dt className="text-xs uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">Saved URL</dt>
          <dd className="mt-1 break-all font-medium text-foreground">{source.baseUrl}</dd>
        </div>
        <div className="rounded-2xl border border-border bg-card/80 px-4 py-3">
          <dt className="text-xs uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">Details</dt>
          <dd className="mt-1 font-medium text-foreground">
            {[product, platform].filter(Boolean).join(" • ") || "No extra metadata"}
          </dd>
        </div>
      </dl>

      {source.lastError && (
        <div className={cn("mt-4 rounded-2xl border px-4 py-3 text-sm", attentionSurfaceClasses)}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">Last check failed</div>
              <div className="mt-1">{source.lastError}</div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!canSaveEdits}
          className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          Save Changes
        </button>
        <button
          type="button"
          onClick={() => void onToggleEnabled()}
          disabled={isBusy}
          className={cn(
            "rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            source.enabled
              ? "bg-muted text-foreground hover:bg-accent"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          {source.enabled ? "Disable" : "Enable"}
        </button>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={isBusy}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={cn("h-4 w-4", busyAction === "Refreshing..." && "animate-spin")} />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => void onRemove()}
          disabled={isBusy}
          className="inline-flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="h-4 w-4" />
          Remove
        </button>
      </div>
    </article>
  );
}
