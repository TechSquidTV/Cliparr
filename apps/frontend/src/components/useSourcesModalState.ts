import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cliparrClient } from "../api/cliparrClient";
import { useAuth } from "../auth";
import type { MediaSource, ProviderSession } from "../providers/types";
import type { Feedback, SourceFilter } from "./sourcesModalTypes";
import {
  buildSourceEditInput,
  draftBaseUrlsFor,
  draftNamesFor,
  filterSources,
  mergeRefreshAllSourceResults,
  sourceCounts,
  sourceProviderOptions,
  sortSources,
} from "./sourcesModalStateUtils";

interface UseSourcesModalStateOptions {
  isOpen: boolean;
  onSourcesChanged?: () => Promise<void> | void;
}

interface SourceActionResult {
  feedback: Feedback;
  source?: MediaSource;
  removeSourceId?: string;
}

export function useSourcesModalState({
  isOpen,
  onSourcesChanged,
}: UseSourcesModalStateOptions) {
  const auth = useAuth();
  const [sources, setSources] = useState<MediaSource[]>([]);
  const [draftBaseUrls, setDraftBaseUrls] = useState<Record<string, string>>(
    {},
  );
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
  const [initialSourcesLoaded, setInitialSourcesLoaded] = useState(false);
  const latestLoadRequestIdRef = useRef(0);
  const isOpenRef = useRef(isOpen);

  const replaceSources = useCallback((nextSources: MediaSource[]) => {
    setSources(nextSources);
    setDraftBaseUrls(draftBaseUrlsFor(nextSources));
    setDraftNames(draftNamesFor(nextSources));
  }, []);

  const applyLoadedSources = useCallback(
    async (requestId: number) => {
      const nextSources = sortSources(await cliparrClient.listSources());
      if (requestId !== latestLoadRequestIdRef.current || !isOpenRef.current) {
        return false;
      }

      replaceSources(nextSources);
      return true;
    },
    [replaceSources],
  );

  const loadSources = useCallback(
    async (mode: "initial" | "reload" = "initial") => {
      const requestId = latestLoadRequestIdRef.current + 1;
      latestLoadRequestIdRef.current = requestId;
      const isCurrentRequest = () =>
        requestId === latestLoadRequestIdRef.current && isOpenRef.current;

      if (mode === "initial") {
        setInitialSourcesLoaded(false);
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

        const message =
          err instanceof Error ? err.message : "Could not load sources.";
        setSources([]);
        setDraftBaseUrls({});
        setDraftNames({});
        setError(message);
      } finally {
        if (isCurrentRequest()) {
          if (mode === "initial") {
            setLoading(false);
            setInitialSourcesLoaded(true);
          } else {
            setReloading(false);
          }
        }
      }
    },
    [applyLoadedSources],
  );

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
      return sortSources(
        exists
          ? current.map((item) => (item.id === source.id ? source : item))
          : [...current, source],
      );
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

  async function runSourceAction(
    source: MediaSource,
    busyAction: string,
    fallbackError: string,
    action: () => Promise<SourceActionResult>,
  ) {
    setFeedback(null);
    setError("");
    updateBusyAction(source.id, busyAction);

    try {
      const result = await action();
      if (result.source) {
        upsertSource(result.source);
      }
      if (result.removeSourceId) {
        removeSource(result.removeSourceId);
      }
      setFeedback(result.feedback);
      await refreshPlaybackView();
    } catch (err) {
      const message = err instanceof Error ? err.message : fallbackError;
      setError(message);
    } finally {
      updateBusyAction(source.id);
    }
  }

  async function handleSourceConnected(session: ProviderSession) {
    auth.setProviderSession(session);
    setFeedback({
      tone: "success",
      message: "Source connected.",
    });
    setShowAddSource(false);
    await loadSources("reload");
    await refreshPlaybackView();
  }

  async function saveSourceEdits(source: MediaSource) {
    const input = buildSourceEditInput(source, draftNames, draftBaseUrls);

    if (Object.keys(input).length === 0) {
      return;
    }

    await runSourceAction(
      source,
      "Saving...",
      "Could not update source.",
      async () => {
        const updatedSource = await cliparrClient.updateSource(
          source.id,
          input,
        );

        return {
          source: updatedSource,
          feedback: {
            tone: "success",
            message: `Updated ${updatedSource.name}.`,
          },
        };
      },
    );
  }

  async function toggleSourceEnabled(source: MediaSource) {
    await runSourceAction(
      source,
      source.enabled ? "Disabling..." : "Enabling...",
      "Could not update source.",
      async () => {
        const updatedSource = await cliparrClient.updateSource(source.id, {
          enabled: !source.enabled,
        });

        return {
          source: updatedSource,
          feedback: {
            tone: "success",
            message: `${updatedSource.name} is now ${updatedSource.enabled ? "enabled" : "disabled"}.`,
          },
        };
      },
    );
  }

  async function checkSource(source: MediaSource) {
    await runSourceAction(
      source,
      "Refreshing...",
      "Could not refresh source.",
      async () => {
        const result = await cliparrClient.checkSource(source.id);

        return {
          source: result.source,
          feedback: {
            tone: result.ok ? "success" : "warning",
            message: result.ok
              ? `${result.source.name} is healthy.`
              : `${result.source.name} still needs attention.`,
          },
        };
      },
    );
  }

  async function deleteSource(source: MediaSource) {
    const confirmed = window.confirm(
      `Remove ${source.name}? It can be reconnected later.`,
    );
    if (!confirmed) {
      return;
    }

    await runSourceAction(
      source,
      "Removing...",
      "Could not remove source.",
      async () => {
        await cliparrClient.deleteSource(source.id);

        return {
          removeSourceId: source.id,
          feedback: {
            tone: "success",
            message: `Removed ${source.name}.`,
          },
        };
      },
    );
  }

  async function refreshAllSources() {
    if (sources.length === 0) {
      return;
    }

    setFeedback(null);
    setError("");
    setRefreshingAll(true);
    setBusyActions(
      Object.fromEntries(sources.map((source) => [source.id, "Refreshing..."])),
    );

    try {
      const results = await Promise.allSettled(
        sources.map(async (source) => {
          const result = await cliparrClient.checkSource(source.id);
          return { source, result };
        }),
      );

      const merged = mergeRefreshAllSourceResults(sources, results);
      replaceSources(merged.sources);

      setFeedback(merged.feedback);
      await refreshPlaybackView();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not refresh sources.";
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
      setInitialSourcesLoaded(false);
      return;
    }

    setFeedback(null);
    void loadSources();
  }, [isOpen, loadSources]);

  useEffect(() => {
    if (!isOpen || loading || !initialSourcesLoaded) {
      return;
    }

    if (sources.length === 0) {
      setShowAddSource(true);
    }
  }, [initialSourcesLoaded, isOpen, loading, sources.length]);

  const providerOptions = useMemo(
    () => sourceProviderOptions(sources),
    [sources],
  );

  useEffect(() => {
    if (providerFilter === "all" || providerOptions.includes(providerFilter)) {
      return;
    }

    setProviderFilter("all");
  }, [providerFilter, providerOptions]);

  const counts = useMemo(() => sourceCounts(sources), [sources]);

  const filteredSources = useMemo(
    () =>
      filterSources({
        sources,
        providerFilter,
        statusFilter,
        query,
      }),
    [providerFilter, query, sources, statusFilter],
  );

  const updateDraftName = useCallback((sourceId: string, value: string) => {
    setDraftNames((current) => ({
      ...current,
      [sourceId]: value,
    }));
  }, []);

  const updateDraftBaseUrl = useCallback((sourceId: string, value: string) => {
    setDraftBaseUrls((current) => ({
      ...current,
      [sourceId]: value,
    }));
  }, []);

  const hasBusyActions = Object.keys(busyActions).length > 0;
  const forceAddSourceOpen = !loading && sources.length === 0;
  const showConnectPanel = showAddSource || forceAddSourceOpen;

  return {
    sources,
    filteredSources,
    draftBaseUrls,
    draftNames,
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    providerFilter,
    setProviderFilter,
    providerOptions,
    loading,
    reloading,
    refreshingAll,
    busyActions,
    error,
    feedback,
    showConnectPanel,
    forceAddSourceOpen,
    hasBusyActions,
    counts,
    setShowAddSource,
    loadSources,
    refreshAllSources,
    handleSourceConnected,
    saveSourceEdits,
    toggleSourceEnabled,
    checkSource,
    deleteSource,
    updateDraftName,
    updateDraftBaseUrl,
  };
}
