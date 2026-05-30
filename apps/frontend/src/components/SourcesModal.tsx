import { useRef } from "react";
import {
  SourceCard,
  SourcesConnectSection,
  SourcesEmptyState,
  SourcesModalAlerts,
  SourcesModalFilters,
  SourcesModalHeader,
} from "./SourcesModalSections";
import { useModalFocusTrap } from "./useModalFocusTrap";
import { useSourcesModalState } from "./useSourcesModalState";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSourcesChanged?: () => Promise<void> | void;
}

export default function SourcesModal({
  isOpen,
  onClose,
  onSourcesChanged,
}: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const {
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
  } = useSourcesModalState({
    isOpen,
    onSourcesChanged,
  });

  useModalFocusTrap({
    isOpen,
    dialogRef,
    initialFocusRef: searchInputRef,
    onEscape: onClose,
  });

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
                description="Connect a Plex or Jellyfin server to get started."
              />
            ) : filteredSources.length === 0 ? (
              <SourcesEmptyState
                title="No sources match this view"
                description="Try another filter or search."
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
                    onDraftNameChange={(value) =>
                      updateDraftName(source.id, value)
                    }
                    onDraftBaseUrlChange={(value) =>
                      updateDraftBaseUrl(source.id, value)
                    }
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
