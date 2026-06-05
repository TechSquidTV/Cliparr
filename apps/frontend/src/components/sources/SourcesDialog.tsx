import { useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DialogWindow } from "@/components/ui/dialog";
import {
  SourceCard,
  SourcesConnectSection,
  SourcesEmptyState,
  SourcesDialogAlerts,
  SourcesDialogFilters,
  SourcesDialogHeader,
} from "@/components/sources/SourcesDialogSections";
import { useSourcesState } from "@/components/sources/useSourcesState";
import { cliparrMotionTransitions } from "@/lib/motionPresets";

interface Properties {
  isOpen: boolean;
  onClose: () => void;
  onSourcesChanged?: () => Promise<void> | void;
}

const SOURCES_STATE_INITIAL = {
  opacity: 0,
  y: 6,
  filter: "blur(8px)",
};
const SOURCES_STATE_VISIBLE = {
  opacity: 1,
  y: 0,
  filter: "blur(0px)",
};
const SOURCES_STATE_EXIT = {
  opacity: 0,
  y: -4,
  filter: "blur(6px)",
};

export default function SourcesDialog({
  isOpen,
  onClose,
  onSourcesChanged,
}: Properties) {
  const searchInputReference = useRef<HTMLInputElement | null>(null);
  const reduceMotion = useReducedMotion();
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
  } = useSourcesState({
    isOpen,
    onSourcesChanged,
  });
  const stateTransition = reduceMotion
    ? { duration: 0 }
    : cliparrMotionTransitions.standard;
  const exitTransition = reduceMotion
    ? { duration: 0 }
    : cliparrMotionTransitions.fast;
  const layoutTransition = reduceMotion
    ? { duration: 0 }
    : cliparrMotionTransitions.layout;

  function renderSourcesContent() {
    if (loading) {
      return (
        <motion.div
          key="sources-loading"
          layout={!reduceMotion}
          className="flex flex-col gap-3"
          data-sources-loading-list
          transition={layoutTransition}
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <motion.div
              key={index}
              layout={!reduceMotion}
              className="h-56 animate-pulse rounded-lg border border-border bg-muted/60"
              exit={SOURCES_STATE_EXIT}
              transition={
                reduceMotion
                  ? exitTransition
                  : {
                      ...exitTransition,
                      delay: index * 0.025,
                    }
              }
            />
          ))}
        </motion.div>
      );
    }

    if (sources.length === 0) {
      return (
        <motion.div
          key="sources-empty"
          layout={!reduceMotion}
          data-sources-empty-state
          initial={reduceMotion ? { opacity: 1 } : SOURCES_STATE_INITIAL}
          animate={SOURCES_STATE_VISIBLE}
          exit={SOURCES_STATE_EXIT}
          transition={stateTransition}
        >
          <SourcesEmptyState
            title="No sources connected yet"
            description="Connect a Plex or Jellyfin server to get started."
          />
        </motion.div>
      );
    }

    if (filteredSources.length === 0) {
      return (
        <motion.div
          key="sources-filtered-empty"
          layout={!reduceMotion}
          data-sources-empty-state
          initial={reduceMotion ? { opacity: 1 } : SOURCES_STATE_INITIAL}
          animate={SOURCES_STATE_VISIBLE}
          exit={SOURCES_STATE_EXIT}
          transition={stateTransition}
        >
          <SourcesEmptyState
            title="No sources match this view"
            description="Try another filter or search."
          />
        </motion.div>
      );
    }

    return (
      <motion.div
        key="sources-list"
        layout={!reduceMotion}
        className="flex flex-col gap-3"
        data-sources-list
        initial={reduceMotion ? { opacity: 1 } : SOURCES_STATE_INITIAL}
        animate={SOURCES_STATE_VISIBLE}
        exit={SOURCES_STATE_EXIT}
        transition={stateTransition}
      >
        {filteredSources.map((source, index) => (
          <motion.div
            key={source.id}
            layout={!reduceMotion}
            initial={reduceMotion ? { opacity: 1 } : SOURCES_STATE_INITIAL}
            animate={SOURCES_STATE_VISIBLE}
            exit={SOURCES_STATE_EXIT}
            transition={
              reduceMotion
                ? stateTransition
                : {
                    ...stateTransition,
                    delay: Math.min(index * 0.03, 0.12),
                  }
            }
          >
            <SourceCard
              source={source}
              draftName={draftNames[source.id] ?? source.name}
              draftBaseUrl={draftBaseUrls[source.id] ?? source.baseUrl}
              busyAction={busyActions[source.id]}
              refreshingAll={refreshingAll}
              onDraftNameChange={(value) => updateDraftName(source.id, value)}
              onDraftBaseUrlChange={(value) =>
                updateDraftBaseUrl(source.id, value)
              }
              onSave={() => saveSourceEdits(source)}
              onToggleEnabled={() => toggleSourceEnabled(source)}
              onRefresh={() => checkSource(source)}
              onRemove={() => deleteSource(source)}
            />
          </motion.div>
        ))}
      </motion.div>
    );
  }

  return (
    <DialogWindow
      open={isOpen}
      onClose={onClose}
      ariaLabel="Manage sources"
      initialFocus={searchInputReference}
      portalClassName="p-4 sm:p-6"
      popupClassName="h-full max-w-6xl rounded-lg"
    >
      <SourcesDialogHeader
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

      <SourcesDialogFilters
        searchInputRef={searchInputReference}
        query={query}
        providerFilter={providerFilter}
        providerOptions={providerOptions}
        statusFilter={statusFilter}
        counts={counts}
        onQueryChange={setQuery}
        onProviderFilterChange={setProviderFilter}
        onStatusFilterChange={setStatusFilter}
      />

      <div className="cliparr-editor-scrollbar flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="space-y-3">
          <SourcesDialogAlerts error={error} feedback={feedback} />

          <AnimatePresence mode="popLayout" initial={false}>
            {showConnectPanel && (
              <motion.div
                key="sources-connect-panel"
                layout={!reduceMotion}
                initial={reduceMotion ? { opacity: 1 } : SOURCES_STATE_INITIAL}
                animate={SOURCES_STATE_VISIBLE}
                exit={SOURCES_STATE_EXIT}
                transition={stateTransition}
              >
                <SourcesConnectSection
                  forceAddSourceOpen={forceAddSourceOpen}
                  onClosePanel={() => setShowAddSource(false)}
                  onConnected={handleSourceConnected}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="popLayout" initial={false}>
            {renderSourcesContent()}
          </AnimatePresence>
        </div>
      </div>
    </DialogWindow>
  );
}
