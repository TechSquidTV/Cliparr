import { useRef } from "react";
import { DialogWindow } from "@/components/ui/dialog";
import {
  SourceCard,
  SourcesConnectSection,
  SourcesEmptyState,
  SourcesModalAlerts,
  SourcesModalFilters,
  SourcesModalHeader,
} from "./SourcesModalSections";
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

  return (
    <DialogWindow
      open={isOpen}
      onClose={onClose}
      ariaLabel="Manage sources"
      initialFocus={searchInputRef}
      portalClassName="p-4 sm:p-6"
      popupClassName="h-full max-w-6xl rounded-4xl"
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
    </DialogWindow>
  );
}
