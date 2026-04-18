import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cliparrClient } from "../api/cliparrClient";
import { useAuth } from "../auth";
import type { MediaSource, ProviderSession } from "../providers/types";
import type { Feedback, SourceFilter } from "./SourcesModalSections";
import {
  compareStrings,
  sortSources,
  SourceCard,
  SourcesConnectSection,
  SourcesEmptyState,
  SourcesModalAlerts,
  SourcesModalFilters,
  SourcesModalHeader,
  stringValue,
} from "./SourcesModalSections";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSourcesChanged?: () => Promise<void> | void;
}

export default function SourcesModal({ isOpen, onClose, onSourcesChanged }: Props) {
  const auth = useAuth();
  const [sources, setSources] = useState<MediaSource[]>([]);
  const [draftBaseUrls, setDraftBaseUrls] = useState<Record<string, string>>({});
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
  const [showAddSource, setShowAddSource] = useState(false);
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
    setDraftBaseUrls(Object.fromEntries(nextSources.map((source) => [source.id, source.baseUrl])));
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
      setDraftBaseUrls({});
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
    setSources((current) => {
      const exists = current.some((item) => item.id === source.id);
      return sortSources(exists ? current.map((item) => (item.id === source.id ? source : item)) : [...current, source]);
    });
    setDraftBaseUrls((current) => ({
      ...current,
      [source.id]: source.baseUrl,
    }));
    setDraftNames((current) => ({
      ...current,
      [source.id]: source.name,
    }));
  }

  function removeSource(sourceId: string) {
    setSources((current) => current.filter((source) => source.id !== sourceId));
    setDraftBaseUrls((current) => {
      const next = { ...current };
      delete next[sourceId];
      return next;
    });
    setDraftNames((current) => {
      const next = { ...current };
      delete next[sourceId];
      return next;
    });
  }

  async function refreshPlaybackView() {
    await onSourcesChanged?.();
  }

  async function handleSourceConnected(session: ProviderSession) {
    auth.setProviderSession(session);
    setFeedback({
      tone: "success",
      message: "Source connected. Refreshing your library list now.",
    });
    setShowAddSource(false);
    await loadSources("reload");
    await refreshPlaybackView();
  }

  async function saveSourceEdits(source: MediaSource) {
    const nextName = (draftNames[source.id] ?? source.name).trim();
    const nextBaseUrl = (draftBaseUrls[source.id] ?? source.baseUrl).trim();
    const hasNameChange = Boolean(nextName) && nextName !== source.name;
    const hasBaseUrlChange = Boolean(nextBaseUrl) && nextBaseUrl !== source.baseUrl;

    if (!hasNameChange && !hasBaseUrlChange) {
      return;
    }

    setFeedback(null);
    setError("");
    updateBusyAction(source.id, "Saving...");

    try {
      const updatedSource = await cliparrClient.updateSource(source.id, {
        ...(hasNameChange ? { name: nextName } : {}),
        ...(hasBaseUrlChange ? { baseUrl: nextBaseUrl } : {}),
      });
      upsertSource(updatedSource);
      setFeedback({
        tone: "success",
        message: `Updated ${updatedSource.name}.`,
      });
      await refreshPlaybackView();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update source";
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
      setDraftBaseUrls(Object.fromEntries(mergedSources.map((source) => [source.id, source.baseUrl])));
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
      setShowAddSource(false);
      return;
    }

    setFeedback(null);
    void loadSources();
  }, [isOpen, loadSources]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (loading) {
      return;
    }

    if (sources.length === 0) {
      setShowAddSource(true);
    }
  }, [isOpen, loading, sources.length]);

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
  const forceAddSourceOpen = !loading && sources.length === 0;
  const showConnectPanel = showAddSource || forceAddSourceOpen;

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
        <SourcesModalHeader
          counts={counts}
          forceAddSourceOpen={forceAddSourceOpen}
          showConnectPanel={showConnectPanel}
          loading={loading}
          reloading={reloading}
          refreshingAll={refreshingAll}
          hasBusyActions={hasBusyActions}
          onToggleAddSource={() => setShowAddSource((current) => !current)}
          onReloadList={() => void loadSources("reload")}
          onRefreshAll={() => void refreshAllSources()}
          onClose={onClose}
        />

        <SourcesModalFilters
          searchInputRef={searchInputRef}
          query={query}
          providerFilter={providerFilter}
          providerOptions={providerOptions}
          statusFilter={statusFilter}
          counts={counts}
          onQueryChange={setQuery}
          onProviderFilterChange={setProviderFilter}
          onStatusFilterChange={setStatusFilter}
        />

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
          <div className="space-y-4">
            <SourcesModalAlerts error={error} feedback={feedback} />

            {showConnectPanel && (
              <SourcesConnectSection
                forceAddSourceOpen={forceAddSourceOpen}
                onClosePanel={() => setShowAddSource(false)}
                onConnected={handleSourceConnected}
              />
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
            ) : sources.length === 0 ? (
              <SourcesEmptyState
                title="No sources connected yet"
                description="Use the add-source panel above to connect your first Plex or Jellyfin server."
              />
            ) : filteredSources.length === 0 ? (
              <SourcesEmptyState
                title="No sources match this view"
                description="Try a different filter, clear your search, or reconnect a provider to discover additional media servers."
              />
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {filteredSources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    draftName={draftNames[source.id] ?? source.name}
                    draftBaseUrl={draftBaseUrls[source.id] ?? source.baseUrl}
                    busyAction={busyActions[source.id]}
                    refreshingAll={refreshingAll}
                    onDraftNameChange={(value) => setDraftNames((current) => ({
                      ...current,
                      [source.id]: value,
                    }))}
                    onDraftBaseUrlChange={(value) => setDraftBaseUrls((current) => ({
                      ...current,
                      [source.id]: value,
                    }))}
                    onSave={() => saveSourceEdits(source)}
                    onToggleEnabled={() => toggleSourceEnabled(source)}
                    onRefresh={() => checkSource(source)}
                    onRemove={() => deleteSource(source)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
