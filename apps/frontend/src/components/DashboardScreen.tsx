import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  FolderOpen,
  Globe,
  LogOut,
  Play,
  RefreshCw,
  Settings2,
  Video,
} from "lucide-react";
import { cliparrClient } from "@/api/cliparrClient";
import { cn } from "@/lib/utils";
import { EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME } from "@/lib/viewTransitions";
import {
  formatProviderName,
  ProviderGlyph,
} from "@/components/providers/ProviderGlyph";
import {
  CLIPARR_GITHUB_URL,
  CLIPARR_WEBSITE_URL,
  DashboardMobileMenu,
  GithubIcon,
} from "@/components/DashboardMobileMenu";
import { MobilePwaInstallNudge } from "@/components/MobilePwaInstallNudge";
import {
  flattenDashboardPlaybackItems,
  formatViewerSessionCount,
} from "@/components/dashboardPlaybackItems";
import { cliparrMotionTransitions } from "@/lib/motionPresets";
import type { DashboardPlaybackCardItem } from "@/components/dashboardPlaybackItems";
import type {
  CurrentlyPlayingItem,
  SourcePlaybackError,
  ViewerPlaybackGroup,
} from "@/providers/types";

interface Props {
  activeViewTransitionSessionId?: string | null;
  onSelectSession: (session: CurrentlyPlayingItem) => void;
  onOpenLocalVideo: () => void;
  onOpenSources: () => void;
  onLogout: () => Promise<void> | void;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function looksLikeGeneratedSourceName(value: string) {
  return /^[a-f0-9]{12,64}$/i.test(value.trim());
}

function formatSourceLabel(source: { name: string; providerId: string }) {
  if (!looksLikeGeneratedSourceName(source.name)) {
    return source.name;
  }

  return formatProviderName(source.providerId);
}

function canEditSession(
  session: Pick<CurrentlyPlayingItem, "mediaUrl" | "hlsUrl">,
) {
  return Boolean(session.hlsUrl || session.mediaUrl);
}

function sessionActionLabel(
  session: Pick<CurrentlyPlayingItem, "mediaUrl" | "hlsUrl">,
) {
  return canEditSession(session) ? "Edit Clip" : "No stream";
}

const DASHBOARD_VIDEO_STYLE_CARD_CLASS =
  "relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card text-left text-card-foreground";
const DASHBOARD_VIDEO_STYLE_THUMBNAIL_CLASS =
  "relative aspect-[2/3] w-full shrink-0 overflow-hidden bg-background";
const DASHBOARD_VIDEO_STYLE_BODY_CLASS =
  "flex flex-1 flex-col gap-3 p-3 md:p-4";
const DASHBOARD_PLAYBACK_GRID_CLASS =
  "grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3";
const DASHBOARD_PLAYBACK_STATE_INITIAL = {
  opacity: 0,
  y: 6,
  filter: "blur(8px)",
};
const DASHBOARD_PLAYBACK_STATE_VISIBLE = {
  opacity: 1,
  y: 0,
  filter: "blur(0px)",
};
const DASHBOARD_PLAYBACK_STATE_EXIT = {
  opacity: 0,
  y: -4,
  filter: "blur(6px)",
};
const DASHBOARD_SKELETON_BREAKPOINT_CLASSES = [
  "",
  "hidden md:block",
  "hidden xl:block",
] as const;

function ViewerAvatar({
  name,
  avatarUrl,
  size = "md",
}: {
  name: string;
  avatarUrl?: string;
  size?: "sm" | "md";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const label = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-full bg-primary/10 font-semibold text-primary",
        size === "sm" ? "h-8 w-8 text-sm" : "h-12 w-12 text-lg",
      )}
    >
      {avatarUrl && !imageFailed ? (
        <img
          src={avatarUrl}
          alt={name}
          className="w-full h-full object-cover"
          width={size === "sm" ? 32 : 48}
          height={size === "sm" ? 32 : 48}
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        label
      )}
    </div>
  );
}

function ViewerChip({
  viewer,
  sessionCount,
  playerState,
}: {
  viewer: ViewerPlaybackGroup["viewer"];
  sessionCount: number;
  playerState: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ViewerAvatar name={viewer.name} avatarUrl={viewer.avatarUrl} size="sm" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">
          {viewer.name}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          <span className="capitalize">{playerState}</span>
          <span aria-hidden="true"> · </span>
          {formatViewerSessionCount(sessionCount)}
        </div>
      </div>
    </div>
  );
}

export const DashboardPlaybackCard = memo(function DashboardPlaybackCard({
  card,
  activeViewTransitionSessionId,
  onSelectSession,
}: {
  card: DashboardPlaybackCardItem;
  activeViewTransitionSessionId?: string | null;
  onSelectSession: (session: CurrentlyPlayingItem) => void;
}) {
  const { session: mediaSession, viewer, viewerSessionCount } = card;
  const canEdit = canEditSession(mediaSession);
  const sourceLabel = formatSourceLabel(mediaSession.source);
  const thumbnailViewTransitionName =
    mediaSession.thumbUrl && mediaSession.id === activeViewTransitionSessionId
      ? EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME
      : undefined;

  return (
    <button
      type="button"
      onClick={() => {
        if (canEdit) {
          onSelectSession(mediaSession);
        }
      }}
      disabled={!canEdit}
      className={cn(
        DASHBOARD_VIDEO_STYLE_CARD_CLASS,
        "group transition-all hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border",
      )}
    >
      <div className={DASHBOARD_VIDEO_STYLE_THUMBNAIL_CLASS}>
        {mediaSession.thumbUrl ? (
          <img
            src={mediaSession.thumbUrl}
            alt={mediaSession.title}
            className="absolute inset-0 h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
            width="2000"
            height="3000"
            decoding="async"
            style={
              thumbnailViewTransitionName
                ? {
                    viewTransitionName: thumbnailViewTransitionName,
                  }
                : undefined
            }
          />
        ) : (
          <div className="absolute inset-0 flex h-full w-full items-center justify-center">
            <Video className="h-8 w-8 text-muted-foreground/50" />
          </div>
        )}
        <div className="absolute inset-0 bg-linear-to-t from-card via-card/35 to-transparent" />
        <div className="absolute top-3 left-3">
          <span className="inline-flex max-w-[calc(100vw-7rem)] items-center gap-1.5 rounded-full bg-card/90 px-2.5 py-1 text-ui-label font-medium tracking-wide text-muted-foreground uppercase shadow-sm backdrop-blur-sm">
            <ProviderGlyph
              providerId={mediaSession.source.providerId}
              providerName={sourceLabel}
              className="h-3.5 w-3.5 shrink-0"
            />
            <span className="truncate">{sourceLabel}</span>
          </span>
        </div>
        <div className="absolute bottom-3 left-3 right-3">
          <div className="mb-1 text-xs font-medium text-primary">
            {mediaSession.type.toUpperCase()}
          </div>
          <h3 className="truncate text-xl font-semibold md:text-base">
            {mediaSession.title}
          </h3>
        </div>
      </div>
      <div className={DASHBOARD_VIDEO_STYLE_BODY_CLASS}>
        <ViewerChip
          viewer={viewer}
          sessionCount={viewerSessionCount}
          playerState={mediaSession.playerState}
        />
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="truncate">{mediaSession.playerTitle}</span>
        </div>
        <div className="mt-auto flex w-full items-center justify-center rounded-lg bg-primary/10 py-2 text-sm font-medium text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          {sessionActionLabel(mediaSession)}
        </div>
      </div>
    </button>
  );
});

function DashboardPlaybackCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        DASHBOARD_VIDEO_STYLE_CARD_CLASS,
        "animate-pulse",
        className,
      )}
      aria-hidden="true"
      data-dashboard-playback-skeleton
    >
      <div className={DASHBOARD_VIDEO_STYLE_THUMBNAIL_CLASS}>
        <div className="absolute inset-0 h-full w-full bg-muted/60" />
        <div className="absolute inset-0 bg-linear-to-t from-card via-card/35 to-transparent" />
        <div className="absolute top-3 left-3 h-6 w-36 rounded-full bg-card/90 shadow-sm" />
        <div className="absolute right-3 bottom-3 left-3">
          <div className="mb-2 h-3 w-16 rounded bg-primary/20" />
          <div className="h-6 w-4/5 rounded bg-muted" />
        </div>
      </div>
      <div className={DASHBOARD_VIDEO_STYLE_BODY_CLASS}>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="h-8 w-8 shrink-0 rounded-full bg-primary/10" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="h-3 w-36 rounded bg-muted/70" />
          </div>
        </div>
        <div className="h-5 w-24 rounded bg-muted/70" />
        <div className="mt-auto h-9 w-full rounded-lg bg-primary/10" />
      </div>
    </div>
  );
}

function dashboardSkeletonExit(index: number, loadedCardCount: number) {
  const loadedIndex = Math.max(loadedCardCount - 1, 0);
  const targetIndex = Math.min(index, loadedIndex);

  return {
    opacity: 0,
    x: `${(targetIndex - index) * 104}%`,
    scale: 0.98,
    filter: "blur(8px)",
  };
}

function DashboardPlaybackMotionRegion({
  loading,
  error,
  playbackCards,
  emptyMessage,
  activeViewTransitionSessionId,
  onSelectSession,
}: {
  loading: boolean;
  error: string;
  playbackCards: DashboardPlaybackCardItem[];
  emptyMessage: string;
  activeViewTransitionSessionId?: string | null;
  onSelectSession: (session: CurrentlyPlayingItem) => void;
}) {
  const reduceMotion = useReducedMotion();
  const hasPlaybackCards = playbackCards.length > 0;
  const stateTransition = reduceMotion
    ? { duration: 0 }
    : cliparrMotionTransitions.standard;
  const exitTransition = reduceMotion
    ? { duration: 0 }
    : cliparrMotionTransitions.fast;
  const layoutTransition = reduceMotion
    ? { duration: 0 }
    : cliparrMotionTransitions.layout;

  return (
    <div data-dashboard-playback-motion>
      <AnimatePresence mode="popLayout" initial={false}>
        {loading && !error && (
          <motion.div
            key="dashboard-playback-loading"
            layout={!reduceMotion}
            role="status"
            aria-live="polite"
            aria-label="Loading currently playing sessions"
            className={DASHBOARD_PLAYBACK_GRID_CLASS}
            data-dashboard-loading-grid
            data-dashboard-loading-items={
              DASHBOARD_SKELETON_BREAKPOINT_CLASSES.length
            }
            transition={layoutTransition}
          >
            {DASHBOARD_SKELETON_BREAKPOINT_CLASSES.map((className, index) => (
              <motion.div
                key={index}
                layout={!reduceMotion}
                className={className}
                exit={
                  reduceMotion
                    ? { opacity: 0 }
                    : dashboardSkeletonExit(index, playbackCards.length)
                }
                transition={
                  reduceMotion
                    ? exitTransition
                    : {
                        ...exitTransition,
                        delay: index * 0.03,
                      }
                }
              >
                <DashboardPlaybackCardSkeleton />
              </motion.div>
            ))}
          </motion.div>
        )}

        {!loading && hasPlaybackCards && !error && (
          <motion.div
            key="dashboard-playback-cards"
            layout={!reduceMotion}
            className={DASHBOARD_PLAYBACK_GRID_CLASS}
            data-dashboard-playback-grid
            initial={
              reduceMotion
                ? DASHBOARD_PLAYBACK_STATE_VISIBLE
                : DASHBOARD_PLAYBACK_STATE_INITIAL
            }
            animate={DASHBOARD_PLAYBACK_STATE_VISIBLE}
            exit={DASHBOARD_PLAYBACK_STATE_EXIT}
            transition={stateTransition}
          >
            {playbackCards.map((card, index) => (
              <motion.div
                key={card.session.id}
                layout={!reduceMotion}
                initial={
                  reduceMotion
                    ? { opacity: 1 }
                    : DASHBOARD_PLAYBACK_STATE_INITIAL
                }
                animate={DASHBOARD_PLAYBACK_STATE_VISIBLE}
                exit={DASHBOARD_PLAYBACK_STATE_EXIT}
                transition={
                  reduceMotion
                    ? stateTransition
                    : {
                        ...stateTransition,
                        delay: Math.min(index * 0.04, 0.12),
                      }
                }
              >
                <DashboardPlaybackCard
                  card={card}
                  activeViewTransitionSessionId={activeViewTransitionSessionId}
                  onSelectSession={onSelectSession}
                />
              </motion.div>
            ))}
          </motion.div>
        )}

        {!loading && !hasPlaybackCards && !error && (
          <motion.div
            key="dashboard-playback-empty"
            layout={!reduceMotion}
            className="bg-card text-card-foreground border border-border rounded-2xl p-12 text-center"
            data-dashboard-empty-state
            initial={
              reduceMotion ? { opacity: 1 } : DASHBOARD_PLAYBACK_STATE_INITIAL
            }
            animate={DASHBOARD_PLAYBACK_STATE_VISIBLE}
            exit={DASHBOARD_PLAYBACK_STATE_EXIT}
            transition={stateTransition}
          >
            <div className="bg-background w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Play className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">
              Nothing is playing right now
            </h3>
            <p className="text-muted-foreground text-sm max-w-sm mx-auto">
              {emptyMessage}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
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
    <div className="rounded-xl border border-status-warning-border bg-status-warning p-4 text-status-warning-foreground">
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
                  {formatSourceLabel({
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
  onLogout,
}: Props) {
  const [viewers, setViewers] = useState<ViewerPlaybackGroup[]>([]);
  const [sourceErrors, setSourceErrors] = useState<SourcePlaybackError[]>([]);
  const [appVersion, setAppVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const hasFetchedSessionsRef = useRef(false);

  const fetchSessions = useCallback(async () => {
    const isInitialFetch = !hasFetchedSessionsRef.current;
    if (isInitialFetch) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError("");

    try {
      const playback = await cliparrClient.getCurrentlyPlaying();
      setViewers(playback.viewers);
      setSourceErrors(playback.sourceErrors);
    } catch (err: unknown) {
      setError(errorMessage(err, "Could not load sessions."));
      setViewers([]);
      setSourceErrors([]);
    } finally {
      hasFetchedSessionsRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    let cancelled = false;

    void cliparrClient
      .getHealth()
      .then((health) => {
        if (!cancelled) {
          setAppVersion(health.version ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppVersion("");
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
  const hasPlaybackCards = playbackCards.length > 0;
  const showPlaybackGrid = loading || hasPlaybackCards;
  const emptyMessage =
    sourceErrors.length > 0
      ? "No active playback on the available sources."
      : "No one is currently watching anything.";
  const versionLabel = appVersion;

  return (
    <div className="min-h-screen bg-background p-4 text-foreground sm:p-8">
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
                  <span
                    className={cn(
                      "hidden min-h-5 min-w-15 items-center justify-center rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground sm:inline-flex",
                      !versionLabel && "invisible",
                    )}
                    aria-hidden={!versionLabel}
                    data-dashboard-version-badge
                  >
                    {versionLabel || "0.0.0"}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Export clips from active playback sessions.
                </p>
              </div>
            </div>
            <DashboardMobileMenu
              appVersion={versionLabel}
              onLogout={onLogout}
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-2 sm:hidden">
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
            <button
              type="button"
              onClick={fetchSessions}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Refresh sessions"
              title="Refresh"
            >
              <RefreshCw
                className={`h-5 w-5 ${loading || refreshing ? "animate-spin text-primary" : ""}`}
              />
            </button>
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
            <button
              type="button"
              onClick={fetchSessions}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
              aria-label="Refresh sessions"
              title="Refresh"
            >
              <RefreshCw
                className={`w-5 h-5 ${loading || refreshing ? "animate-spin text-primary" : ""}`}
              />
            </button>
            <a
              href={CLIPARR_WEBSITE_URL}
              target="_blank"
              rel="noreferrer"
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
              aria-label="Open Cliparr website"
              title="Open Cliparr website"
            >
              <Globe className="h-5 w-5" />
            </a>
            <a
              href={CLIPARR_GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
              aria-label="View Cliparr on GitHub"
              title="View Cliparr on GitHub"
            >
              <GithubIcon className="h-5 w-5" />
            </a>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Disconnect
            </button>
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

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-xl text-sm">
              {error}
            </div>
          )}

          {!error && <WarningBanner sourceErrors={sourceErrors} />}

          <DashboardPlaybackMotionRegion
            loading={loading}
            error={error}
            playbackCards={playbackCards}
            emptyMessage={emptyMessage}
            activeViewTransitionSessionId={activeViewTransitionSessionId}
            onSelectSession={onSelectSession}
          />
        </div>
      </div>
    </div>
  );
}
