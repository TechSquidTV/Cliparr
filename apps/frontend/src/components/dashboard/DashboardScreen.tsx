import type {
  CurrentlyPlayingItem,
  SourcePlaybackError,
} from "@cliparr/shared/providers";
import {
  AlertTriangle,
  FolderOpen,
  Globe,
  LogOut,
  Settings2,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cliparrClient, type CliparrVersionInfo } from "#/api/cliparrClient";
import {
  CLIPARR_GITHUB_URL,
  CLIPARR_WEBSITE_URL,
  DashboardMobileMenu,
  GithubIcon,
} from "#/components/dashboard/DashboardMobileMenu";
import { formatDashboardSourceLabel } from "#/components/dashboard/DashboardPlaybackCard";
import {
  activeDashboardViewerFilterNames,
  buildDashboardViewerFilterOptions,
  canUseDashboardViewerFilter,
  countDashboardViewerFilterHiddenCards,
  filterDashboardPlaybackCardsByViewer,
  flattenDashboardPlaybackItems,
  readDashboardViewerFilter,
  sanitizeDashboardViewerFilterNames,
  writeDashboardViewerFilter,
} from "#/components/dashboard/dashboardPlaybackItems";
import { DashboardPlaybackMotionRegion } from "#/components/dashboard/DashboardPlaybackRegion";
import { DashboardPlaybackStatus } from "#/components/dashboard/DashboardPlaybackStatus";
import { DashboardVersionBadge } from "#/components/dashboard/DashboardVersionBadge";
import { DashboardViewerFilterPicker } from "#/components/dashboard/DashboardViewerFilter";
import { MobilePwaInstallNudge } from "#/components/dashboard/MobilePwaInstallNudge";
import { useLivePlayback } from "#/components/dashboard/useLivePlayback";
import {
  destructiveAlertClasses,
  warningAlertClasses,
} from "#/components/ui/control-styles";
import { ControlTooltip } from "#/components/ui/tooltip";
import { cn } from "#/lib/cn";
import { motionTransitionFor } from "#/lib/motion";

interface Properties {
  activeViewTransitionSessionId?: string | null;
  onSelectSession: (session: CurrentlyPlayingItem) => void;
  onOpenLocalVideo: () => void;
  onOpenSources: () => void;
  onDisconnect: () => Promise<void> | void;
}

function WarningBanner({
  sourceErrors,
}: {
  sourceErrors: SourcePlaybackError[];
}) {
  if (sourceErrors.length === 0) {
    return null;
  }

  return (
    <div role="status" className={warningAlertClasses}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="space-y-2 text-sm">
          <p className="font-medium">
            Some sources are unavailable. Showing the rest.
          </p>
          <div className="space-y-1">
            {sourceErrors.map((sourceError) => (
              <p key={sourceError.sourceId}>
                <span className="font-medium">
                  {formatDashboardSourceLabel({
                    name: sourceError.sourceName,
                    providerId: sourceError.providerId,
                  })}
                </span>
                : {sourceError.message}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardScreen({
  activeViewTransitionSessionId,
  onSelectSession,
  onOpenLocalVideo,
  onOpenSources,
  onDisconnect,
}: Properties) {
  const {
    viewers,
    sourceErrors,
    sources,
    loading: pending,
    connection,
    retry,
  } = useLivePlayback();
  const loading =
    pending && connection !== "reconnecting" && viewers.length === 0;
  const error =
    connection === "reconnecting"
      ? "Reconnecting live updates. Sessions may be out of date."
      : "";
  const [versionInfo, setVersionInfo] = useState<CliparrVersionInfo | null>(
    null,
  );
  const [selectedViewerNames, setSelectedViewerNames] = useState(() =>
    readDashboardViewerFilter(),
  );
  const reduceDashboardMotion = useReducedMotion();
  const dashboardTransition = motionTransitionFor(
    "fast",
    reduceDashboardMotion,
  );

  useEffect(() => {
    let cancelled = false;

    void cliparrClient
      .getVersionInfo()
      .then((nextVersionInfo) => {
        if (!cancelled) {
          setVersionInfo(nextVersionInfo);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVersionInfo(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const playbackCards = useMemo(
    () => flattenDashboardPlaybackItems(viewers),
    [viewers],
  );
  const storedViewerFilterNames = useMemo(
    () => sanitizeDashboardViewerFilterNames(selectedViewerNames),
    [selectedViewerNames],
  );
  const viewerFilterOptions = useMemo(
    () => buildDashboardViewerFilterOptions(playbackCards),
    [playbackCards],
  );
  const canFilterByViewer = canUseDashboardViewerFilter(viewerFilterOptions);
  const selectedViewerFilterNames = useMemo(
    () =>
      activeDashboardViewerFilterNames(
        viewerFilterOptions,
        storedViewerFilterNames,
      ),
    [viewerFilterOptions, storedViewerFilterNames],
  );
  const filteredPlaybackCards = useMemo(
    () =>
      filterDashboardPlaybackCardsByViewer(
        playbackCards,
        selectedViewerFilterNames,
      ),
    [playbackCards, selectedViewerFilterNames],
  );
  const hiddenViewerFilterCardCount = useMemo(
    () =>
      countDashboardViewerFilterHiddenCards(
        playbackCards,
        selectedViewerFilterNames,
      ),
    [playbackCards, selectedViewerFilterNames],
  );
  const hasAnyPlaybackCards = playbackCards.length > 0;
  const showPlaybackGrid = loading || hasAnyPlaybackCards;
  const emptyMessage =
    sourceErrors.length > 0
      ? "No active playback on the available sources."
      : "No one is currently watching anything.";
  const versionLabel = versionInfo?.currentVersion ?? "";
  const latestUpdateRelease =
    versionInfo?.status === "update_available" && versionInfo.latestRelease
      ? versionInfo.latestRelease
      : null;
  let releaseChecksDisabledReason: string | null = null;
  if (versionLabel && versionInfo?.status === "unknown") {
    releaseChecksDisabledReason =
      versionLabel === "dev"
        ? "Local development build; release update checks are disabled"
        : "Non-release build; release update checks are disabled";
  }

  const toggleViewerFilter = useCallback((viewerName: string) => {
    const [normalizedName] = sanitizeDashboardViewerFilterNames([viewerName]);
    if (!normalizedName) {
      return;
    }

    setSelectedViewerNames((current) => {
      const currentNames = sanitizeDashboardViewerFilterNames(current);
      const nextNames = currentNames.includes(normalizedName)
        ? currentNames.filter((name) => name !== normalizedName)
        : [...currentNames, normalizedName];
      writeDashboardViewerFilter(nextNames);
      return nextNames;
    });
  }, []);

  const clearViewerFilter = useCallback(() => {
    setSelectedViewerNames([]);
    writeDashboardViewerFilter([]);
  }, []);

  useEffect(() => {
    if (loading || canFilterByViewer || storedViewerFilterNames.length === 0) {
      return;
    }

    clearViewerFilter();
  }, [canFilterByViewer, clearViewerFilter, loading, storedViewerFilterNames]);

  const showViewerFilterControl = canFilterByViewer;
  const renderViewerFilterPicker = () =>
    showViewerFilterControl ? (
      <DashboardViewerFilterPicker
        viewerOptions={viewerFilterOptions}
        selectedViewerNames={selectedViewerFilterNames}
        hiddenSessionCount={hiddenViewerFilterCardCount}
        onToggleViewer={toggleViewerFilter}
        onClearViewerFilter={clearViewerFilter}
      />
    ) : null;

  return (
    <div className="min-h-(--app-viewport-height) bg-background p-4 text-foreground sm:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-5 space-y-4 sm:mb-12 sm:flex sm:items-center sm:justify-between sm:space-y-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src="/logo-light.svg"
                alt="Cliparr Logo"
                className="w-8 h-8"
                width="32"
                height="32"
                decoding="async"
              />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight">Cliparr</h1>
                  <DashboardVersionBadge
                    versionLabel={versionLabel}
                    latestRelease={latestUpdateRelease}
                    releaseChecksDisabledReason={releaseChecksDisabledReason}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  Export clips from active playback sessions.
                </p>
              </div>
            </div>
            <DashboardMobileMenu
              appVersion={versionLabel}
              latestRelease={latestUpdateRelease}
              onDisconnect={onDisconnect}
            />
          </div>
          <div
            className={cn(
              "grid gap-2 sm:hidden",
              showViewerFilterControl ? "grid-cols-3" : "grid-cols-2",
            )}
          >
            <button
              type="button"
              onClick={onOpenLocalVideo}
              className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              <FolderOpen className="h-4 w-4 shrink-0" />
              <span className="truncate">Open Video</span>
            </button>
            <button
              type="button"
              onClick={onOpenSources}
              className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              <Settings2 className="h-4 w-4 shrink-0" />
              <span className="truncate">Sources</span>
            </button>
            {renderViewerFilterPicker()}
          </div>
          <MobilePwaInstallNudge />
          <div className="hidden flex-wrap items-center gap-3 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={onOpenLocalVideo}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <FolderOpen className="w-4 h-4" />
              Open Video
            </button>
            <button
              type="button"
              onClick={onOpenSources}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Settings2 className="w-4 h-4" />
              Sources
            </button>
            {renderViewerFilterPicker()}

            <ControlTooltip label="Open Cliparr website">
              <a
                href={CLIPARR_WEBSITE_URL}
                target="_blank"
                rel="noreferrer"
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
                aria-label="Open Cliparr website"
              >
                <Globe className="h-5 w-5" />
              </a>
            </ControlTooltip>
            <ControlTooltip label="View Cliparr on GitHub">
              <a
                href={CLIPARR_GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
                aria-label="View Cliparr on GitHub"
              >
                <GithubIcon className="h-5 w-5" />
              </a>
            </ControlTooltip>
            <ControlTooltip label="Disconnect">
              <motion.button
                type="button"
                onClick={onDisconnect}
                className={cn(
                  "control-focus flex items-center gap-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  showViewerFilterControl
                    ? "h-9 w-9 justify-center p-2"
                    : "px-4 py-2",
                )}
                aria-label="Disconnect"
                whileHover={
                  showViewerFilterControl && !reduceDashboardMotion
                    ? { y: -1 }
                    : undefined
                }
                whileTap={
                  showViewerFilterControl && !reduceDashboardMotion
                    ? { scale: 0.985 }
                    : undefined
                }
                transition={dashboardTransition}
              >
                <LogOut className="w-4 h-4" />
                {!showViewerFilterControl && "Disconnect"}
              </motion.button>
            </ControlTooltip>
          </div>
        </header>

        <div
          className={showPlaybackGrid ? "space-y-4 sm:space-y-6" : "space-y-6"}
        >
          <div className={showPlaybackGrid ? "sr-only" : ""}>
            <h2 className="text-xl font-semibold mb-2">Currently Playing</h2>
            <p className="text-muted-foreground text-sm">
              Active sessions across enabled sources.
            </p>
          </div>

          <DashboardPlaybackStatus
            sources={sources}
            connection={connection}
            hasSourceErrors={sourceErrors.length > 0}
            onRetry={retry}
          />

          {error && (
            <div role="alert" className={destructiveAlertClasses}>
              {error}
            </div>
          )}

          {!error && <WarningBanner sourceErrors={sourceErrors} />}

          <DashboardPlaybackMotionRegion
            loading={loading}
            error={
              error ||
              (viewers.length === 0 && sourceErrors.length > 0
                ? "Sources unavailable"
                : "")
            }
            playbackCards={filteredPlaybackCards}
            filteredByViewer={selectedViewerFilterNames.length > 0}
            hiddenSessionCount={hiddenViewerFilterCardCount}
            emptyMessage={emptyMessage}
            activeViewTransitionSessionId={activeViewTransitionSessionId}
            onSelectSession={onSelectSession}
            onClearViewerFilter={clearViewerFilter}
            onOpenLocalVideo={onOpenLocalVideo}
            onOpenSources={onOpenSources}
          />
        </div>
      </div>
    </div>
  );
}
