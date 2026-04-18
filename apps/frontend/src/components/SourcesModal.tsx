import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  RefreshCw,
  Search,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { cliparrClient } from "../api/cliparrClient";
import { formatProviderName } from "./ProviderGlyph";
import { cn } from "../lib/utils";
import type { MediaSource } from "../providers/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSourcesChanged?: () => Promise<void> | void;
}

type SourceFilter = "all" | "enabled" | "disabled" | "attention";

interface Feedback {
  tone: "error" | "success" | "warning";
  message: string;
}

const healthySurfaceClasses =
  "border-[color:color-mix(in_oklch,var(--primary)_24%,transparent)] bg-[color:color-mix(in_oklch,var(--primary)_12%,var(--background))] text-[color:color-mix(in_oklch,var(--primary)_78%,var(--foreground))]";
const attentionSurfaceClasses =
  "border-[color:color-mix(in_oklch,var(--destructive)_24%,transparent)] bg-[color:color-mix(in_oklch,var(--destructive)_12%,var(--background))] text-[color:color-mix(in_oklch,var(--destructive)_72%,var(--foreground))]";
const secondarySurfaceClasses =
  "border-[color:color-mix(in_oklch,var(--secondary)_24%,transparent)] bg-[color:color-mix(in_oklch,var(--secondary)_12%,var(--background))] text-[color:color-mix(in_oklch,var(--secondary)_64%,var(--foreground))]";
const elevatedGlassClasses =
  "border-[color:color-mix(in_oklch,var(--foreground)_10%,transparent)] bg-[color:color-mix(in_oklch,var(--card)_72%,transparent)]";

function compareStrings(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

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

function sortSources(sources: MediaSource[]) {
  return [...sources].sort((left, right) =>
    compareStrings(formatProviderName(left.providerId), formatProviderName(right.providerId))
    || compareStrings(left.name, right.name)
    || compareStrings(left.id, right.id)
  );
}

export default function SourcesModal({ isOpen, onClose, onSourcesChanged }: Props) {
  const [sources, setSources] = useState<MediaSource[]>([]);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SourceFilter>("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [busyActions, setBusyActions] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const latestLoadRequestIdRef = useRef(0);
  const isOpenRef = useRef(isOpen);

  const applyLoadedSources = useCallback(async (requestId: number) => {
    const nextSources = sortSources(await cliparrClient.listSources());
    if (requestId !== latestLoadRequestIdRef.current || !isOpenRef.current) {
      return false;
    }

    setSources(nextSources);
    setDraftNames(Object.fromEntries(nextSources.map((source) => [source.id, source.name])));
    return true;
  }, []);

  const loadSources = useCallback(async (mode: "initial" | "reload" = "initial") => {
    const requestId = latestLoadRequestIdRef.current + 1;
    latestLoadRequestIdRef.current = requestId;
    const isCurrentRequest = () => requestId === latestLoadRequestIdRef.current && isOpenRef.current;

    if (mode === "initial") {
      setLoading(true);
    } else {
      setReloading(true);
    }

    setError("");

    try {
      await applyLoadedSources(requestId);
    } catch (err) {
      if (!isCurrentRequest()) {
        return;
      }

      const message = err instanceof Error ? err.message : "Failed to load sources";
      setSources([]);
      setDraftNames({});
      setError(message);
    } finally {
      if (isCurrentRequest()) {
        if (mode === "initial") {
          setLoading(false);
        } else {
          setReloading(false);
        }
      }
    }
  }, [applyLoadedSources]);

  function updateBusyAction(sourceId: string, action?: string) {
    setBusyActions((current) => {
      const next = { ...current };
      if (action) {
        next[sourceId] = action;
      } else {
        delete next[sourceId];
      }
      return next;
    });
  }

  function upsertSource(source: MediaSource) {
    setSources((current) => sortSources(current.map((item) => (item.id === source.id ? source : item))));
    setDraftNames((current) => ({
      ...current,
      [source.id]: source.name,
    }));
  }

  function removeSource(sourceId: string) {
    setSources((current) => current.filter((source) => source.id !== sourceId));
    setDraftNames((current) => {
      const next = { ...current };
      delete next[sourceId];
      return next;
    });
  }

  async function refreshPlaybackView() {
    await onSourcesChanged?.();
  }

  async function saveSourceName(source: MediaSource) {
    const nextName = (draftNames[source.id] ?? source.name).trim();
    if (!nextName || nextName === source.name) {
      return;
    }

    setFeedback(null);
    setError("");
    updateBusyAction(source.id, "Saving...");

    try {
      const updatedSource = await cliparrClient.updateSource(source.id, { name: nextName });
      upsertSource(updatedSource);
      setFeedback({
        tone: "success",
        message: `Renamed ${updatedSource.name}.`,
      });
      await refreshPlaybackView();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to rename source";
      setError(message);
    } finally {
      updateBusyAction(source.id);
    }
  }

  async function toggleSourceEnabled(source: MediaSource) {
    setFeedback(null);
    setError("");
    updateBusyAction(source.id, source.enabled ? "Disabling..." : "Enabling...");

    try {
      const updatedSource = await cliparrClient.updateSource(source.id, { enabled: !source.enabled });
      upsertSource(updatedSource);
      setFeedback({
        tone: "success",
        message: `${updatedSource.name} is now ${updatedSource.enabled ? "enabled" : "disabled"}.`,
      });
      await refreshPlaybackView();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update source";
      setError(message);
    } finally {
      updateBusyAction(source.id);
    }
  }

  async function checkSource(source: MediaSource) {
    setFeedback(null);
    setError("");
    updateBusyAction(source.id, "Refreshing...");

    try {
      const result = await cliparrClient.checkSource(source.id);
      upsertSource(result.source);
      setFeedback({
        tone: result.ok ? "success" : "warning",
        message: result.ok
          ? `${result.source.name} passed its health check.`
          : `${result.source.name} still needs attention.`,
      });
      await refreshPlaybackView();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh source";
      setError(message);
    } finally {
      updateBusyAction(source.id);
    }
  }

  async function deleteSource(source: MediaSource) {
    const confirmed = window.confirm(
      `Remove ${source.name}? Cliparr will stop querying it until it is reconnected.`
    );
    if (!confirmed) {
      return;
    }

    setFeedback(null);
    setError("");
    updateBusyAction(source.id, "Removing...");

    try {
      await cliparrClient.deleteSource(source.id);
      removeSource(source.id);
      setFeedback({
        tone: "success",
        message: `Removed ${source.name}.`,
      });
      await refreshPlaybackView();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove source";
      setError(message);
    } finally {
      updateBusyAction(source.id);
    }
  }

  async function refreshAllSources() {
    if (sources.length === 0) {
      return;
    }

    setFeedback(null);
    setError("");
    setRefreshingAll(true);
    setBusyActions(Object.fromEntries(sources.map((source) => [source.id, "Refreshing..."])));

    try {
      const results = await Promise.allSettled(
        sources.map(async (source) => {
          const result = await cliparrClient.checkSource(source.id);
          return { source, result };
        })
      );

      const nextSources = new Map(sources.map((source) => [source.id, source]));
      let healthyCount = 0;
      let attentionCount = 0;
      let failedCount = 0;

      results.forEach((entry, index) => {
        const currentSource = sources[index];
        if (!currentSource) {
          return;
        }

        if (entry.status === "fulfilled") {
          nextSources.set(entry.value.result.source.id, entry.value.result.source);
          if (entry.value.result.ok) {
            healthyCount += 1;
          } else {
            attentionCount += 1;
          }
          return;
        }

        failedCount += 1;
      });

      const mergedSources = sortSources([...nextSources.values()]);
      setSources(mergedSources);
      setDraftNames(Object.fromEntries(mergedSources.map((source) => [source.id, source.name])));

      const summaryParts = [
        `${healthyCount} healthy`,
        `${attentionCount} need attention`,
      ];
      if (failedCount > 0) {
        summaryParts.push(`${failedCount} failed to refresh`);
      }

      setFeedback({
        tone: attentionCount > 0 || failedCount > 0 ? "warning" : "success",
        message: `Refreshed ${sources.length} source${sources.length === 1 ? "" : "s"}: ${summaryParts.join(", ")}.`,
      });
      await refreshPlaybackView();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to refresh sources";
      setError(message);
    } finally {
      setRefreshingAll(false);
      setBusyActions({});
    }
  }

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (!isOpen) {
      latestLoadRequestIdRef.current += 1;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setFeedback(null);
    void loadSources();
  }, [isOpen, loadSources]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    lastFocusedElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frameId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((element) => element.getAttribute("aria-hidden") !== "true");

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey) {
        if (activeElement === firstFocusable || !dialog.contains(activeElement)) {
          event.preventDefault();
          lastFocusable?.focus();
        }
        return;
      }

      if (activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      lastFocusedElementRef.current?.focus();
    };
  }, [isOpen, onClose]);

  const providerOptions = useMemo(() => {
    const providers = [...new Set(sources.map((source) => source.providerId))];
    return providers.sort(compareStrings);
  }, [sources]);

  useEffect(() => {
    if (providerFilter === "all" || providerOptions.includes(providerFilter)) {
      return;
    }

    setProviderFilter("all");
  }, [providerFilter, providerOptions]);

  const counts = useMemo(() => ({
    all: sources.length,
    enabled: sources.filter((source) => source.enabled).length,
    disabled: sources.filter((source) => !source.enabled).length,
    attention: sources.filter((source) => Boolean(source.lastError)).length,
  }), [sources]);

  const filteredSources = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return sources.filter((source) => {
      if (providerFilter !== "all" && source.providerId !== providerFilter) {
        return false;
      }

      if (statusFilter === "enabled" && !source.enabled) {
        return false;
      }

      if (statusFilter === "disabled" && source.enabled) {
        return false;
      }

      if (statusFilter === "attention" && !source.lastError) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        source.name,
        source.baseUrl,
        source.providerId,
        stringValue(source.metadata.product),
        stringValue(source.metadata.platform),
      ].filter(Boolean).join(" ").toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [providerFilter, query, sources, statusFilter]);
  const hasBusyActions = Object.keys(busyActions).length > 0;

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-[color-mix(in_oklch,var(--foreground)_38%,transparent)] p-4 backdrop-blur-sm sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Manage sources"
        tabIndex={-1}
        className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-4xl border border-border bg-card text-card-foreground shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-border bg-[linear-gradient(135deg,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_55%),linear-gradient(180deg,color-mix(in_oklch,var(--muted)_82%,var(--card)),var(--card))] px-5 py-5 sm:px-8 sm:py-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground", elevatedGlassClasses)}>
                <Server className="h-3.5 w-3.5" />
                Source Control
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Manage Sources</h2>
                <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                  Rename servers, pause noisy sources, run health checks, and clean up anything you no longer want Cliparr to query.
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
              <button
                type="button"
                onClick={() => void loadSources("reload")}
                disabled={loading || reloading || refreshingAll}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/80 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={cn("h-4 w-4", (reloading || loading) && "animate-spin")} />
                Reload List
              </button>
              <button
                type="button"
                onClick={() => void refreshAllSources()}
                disabled={loading || reloading || refreshingAll || hasBusyActions || sources.length === 0}
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

        <div className="border-b border-border px-5 py-4 sm:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-3 lg:flex-row">
              <label className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by source name, URL, provider, or platform"
                  className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-4 text-sm outline-none transition-colors focus:border-ring"
                />
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-input bg-background px-4 text-sm text-muted-foreground">
                <span>Provider</span>
                <select
                  value={providerFilter}
                  onChange={(event) => setProviderFilter(event.target.value)}
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
              {([
                ["all", "All"],
                ["enabled", "Enabled"],
                ["disabled", "Disabled"],
                ["attention", "Needs attention"],
              ] as const).map(([value, label]) => {
                const isActive = statusFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value)}
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

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
          <div className="space-y-4">
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

            {loading ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-72 animate-pulse rounded-3xl border border-border bg-muted/60"
                  />
                ))}
              </div>
            ) : filteredSources.length === 0 ? (
              <div className="rounded-[1.75rem] border border-dashed border-border bg-background/60 px-8 py-14 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <Server className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold">No sources match this view</h3>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Try a different filter, clear your search, or reconnect a provider to discover additional media servers.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {filteredSources.map((source) => {
                  const status = sourceStatus(source);
                  const StatusIcon = status.icon;
                  const draftName = draftNames[source.id] ?? source.name;
                  const trimmedName = draftName.trim();
                  const isBusy = Boolean(busyActions[source.id]) || refreshingAll;
                  const canSaveName = Boolean(trimmedName) && trimmedName !== source.name && !isBusy;
                  const product = stringValue(source.metadata.product);
                  const platform = stringValue(source.metadata.platform);

                  return (
                    <article
                      key={source.id}
                      className={cn(
                        "rounded-[1.75rem] border p-5 shadow-sm transition-colors",
                        source.enabled
                          ? "border-border bg-background/90"
                          : "border-border bg-muted/40"
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                            {formatProviderName(source.providerId)}
                          </span>
                          <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium", status.className)}>
                            <StatusIcon className="h-3.5 w-3.5" />
                            {status.label}
                          </span>
                          {busyActions[source.id] && (
                            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                              {busyActions[source.id]}
                            </span>
                          )}
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <div>Checked {formatTimestamp(source.lastCheckedAt)}</div>
                          <div>Updated {formatTimestamp(source.updatedAt)}</div>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2">
                        <label className="block text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Display Name
                        </label>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            value={draftName}
                            onChange={(event) => setDraftNames((current) => ({
                              ...current,
                              [source.id]: event.target.value,
                            }))}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && canSaveName) {
                                event.preventDefault();
                                void saveSourceName(source);
                              }
                            }}
                            disabled={isBusy}
                            className="h-11 flex-1 rounded-xl border border-input bg-card px-4 text-sm outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
                          />
                          <button
                            type="button"
                            onClick={() => void saveSourceName(source)}
                            disabled={!canSaveName}
                            className="h-11 rounded-xl border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Save Name
                          </button>
                        </div>
                      </div>

                      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <div className="rounded-2xl border border-border bg-card/80 px-4 py-3">
                          <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Base URL</dt>
                          <dd className="mt-1 break-all font-medium text-foreground">{source.baseUrl}</dd>
                        </div>
                        <div className="rounded-2xl border border-border bg-card/80 px-4 py-3">
                          <dt className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Details</dt>
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
                          onClick={() => void toggleSourceEnabled(source)}
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
                          onClick={() => void checkSource(source)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RefreshCw className={cn("h-4 w-4", busyActions[source.id] === "Refreshing..." && "animate-spin")} />
                          Refresh
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteSource(source)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
