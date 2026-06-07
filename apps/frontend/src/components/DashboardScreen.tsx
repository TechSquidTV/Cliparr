import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FolderOpen,
  Globe,
  LogOut,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Users,
  Video,
  X,
} from "lucide-react";
import { cliparrClient, type CliparrVersionInfo } from "@/api/cliparrClient";
import { cn } from "@/lib/utilities";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildDashboardViewerFilterOptions,
  countDashboardViewerFilterHiddenCards,
  filterDashboardPlaybackCardsByViewer,
  flattenDashboardPlaybackItems,
  formatViewerSessionCount,
  readDashboardViewerFilter,
  sanitizeDashboardViewerFilterNames,
  writeDashboardViewerFilter,
} from "@/components/dashboardPlaybackItems";
import { cliparrMotionTransitions } from "@/lib/motionPresets";
import type {
  DashboardPlaybackCardItem,
  DashboardViewerFilterOption,
} from "@/components/dashboardPlaybackItems";
import type {
  CurrentlyPlayingItem,
  SourcePlaybackError,
  ViewerPlaybackGroup,
} from "@/providers/types";

interface Properties {
  activeViewTransitionSessionId?: string | null;
  onSelectSession: (session: CurrentlyPlayingItem) => void;
  onOpenLocalVideo: () => void;
  onOpenSources: () => void;
  onDisconnect: () => Promise<void> | void;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function looksLikeGeneratedSourceName(value: string) {
  return /^[\da-f]{12,64}$/i.test(value.trim());
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
  "relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card text-left text-card-foreground";
const DASHBOARD_VIDEO_STYLE_THUMBNAIL_CLASS =
  "relative aspect-[2/3] w-full shrink-0 overflow-hidden bg-background";
const DASHBOARD_VIDEO_STYLE_BODY_CLASS =
  "flex flex-1 flex-col gap-3 p-3 md:p-4";
const DASHBOARD_PLAYBACK_GRID_CLASS =
  "grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3";
const DASHBOARD_VERSION_BADGE_CLASS =
  "hidden min-h-5 min-w-15 items-center justify-center rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground sm:inline-flex";
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
const DASHBOARD_VIEWER_FILTER_TRIGGER_VISIBLE_AVATAR_COUNT = 2;

function viewerAvatarSizeClass(size: "xs" | "sm" | "md") {
  if (size === "xs") {
    return "h-6 w-6 text-[11px]";
  }

  if (size === "sm") {
    return "h-8 w-8 text-sm";
  }

  return "h-12 w-12 text-lg";
}

function viewerAvatarImageSize(size: "xs" | "sm" | "md") {
  if (size === "xs") {
    return 24;
  }

  if (size === "sm") {
    return 32;
  }

  return 48;
}

function ViewerAvatar({
  name,
  avatarUrl,
  size = "md",
}: {
  name: string;
  avatarUrl?: string;
  size?: "xs" | "sm" | "md";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const label = name.trim().charAt(0).toUpperCase() || "?";
  const sizeClass = viewerAvatarSizeClass(size);
  const imageSize = viewerAvatarImageSize(size);

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 font-semibold text-primary",
        sizeClass,
      )}
    >
      {avatarUrl && !imageFailed ? (
        <img
          src={avatarUrl}
          alt={name}
          className="w-full h-full object-cover"
          width={imageSize}
          height={imageSize}
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        label
      )}
    </div>
  );
}

function formatFilterSessionCount(count: number) {
  return `${count} ${count === 1 ? "session" : "sessions"}`;
}

function formatFilterHiddenCount(count: number) {
  return `${count} ${count === 1 ? "session is" : "sessions are"} hidden by the viewer filter.`;
}

function dashboardViewerFilterTriggerLabel(
  viewerOptions: DashboardViewerFilterOption[],
  selectedViewerNames: readonly string[],
) {
  const selectedNames = sanitizeDashboardViewerFilterNames(selectedViewerNames);
  if (selectedNames.length === 0) {
    return "All viewers";
  }

  if (selectedNames.length === 1) {
    const [selectedName] = selectedNames;
    const option = viewerOptions.find(
      (viewerOption) => viewerOption.normalizedName === selectedName,
    );
    return option?.name ?? "1 viewer";
  }

  return `${selectedNames.length} viewers`;
}

function selectedDashboardViewerFilterOptions(
  viewerOptions: DashboardViewerFilterOption[],
  selectedViewerNames: readonly string[],
) {
  const optionsByName = new Map(
    viewerOptions.map((option) => [option.normalizedName, option]),
  );

  return sanitizeDashboardViewerFilterNames(selectedViewerNames).map(
    (selectedName) =>
      optionsByName.get(selectedName) ?? {
        normalizedName: selectedName,
        name: selectedName,
        sessionCount: 0,
      },
  );
}

function DashboardViewerFilterTriggerSelection({
  selectedViewerOptions,
}: {
  selectedViewerOptions: DashboardViewerFilterOption[];
}) {
  const visibleViewerOptions = selectedViewerOptions.slice(
    0,
    DASHBOARD_VIEWER_FILTER_TRIGGER_VISIBLE_AVATAR_COUNT,
  );
  const hiddenViewerCount = Math.max(
    selectedViewerOptions.length - visibleViewerOptions.length,
    0,
  );

  return (
    <span
      className="flex min-w-0 flex-1 items-center justify-center gap-1 sm:justify-end"
      data-dashboard-viewer-filter-selected-avatars
      aria-hidden="true"
    >
      <span className="flex shrink-0 -space-x-2">
        {visibleViewerOptions.map((option, index) => (
          <span
            key={option.normalizedName}
            className="relative rounded-full ring-2 ring-background"
            style={{ zIndex: index + 1 }}
          >
            <ViewerAvatar
              name={option.name}
              avatarUrl={option.avatarUrl}
              size="xs"
            />
          </span>
        ))}
      </span>
      {hiddenViewerCount > 0 ? (
        <span
          className="inline-flex h-6 shrink-0 items-center rounded-full border border-border bg-background px-1.5 text-[11px] leading-none font-semibold text-muted-foreground"
          data-dashboard-viewer-filter-overflow-count
        >
          (+{hiddenViewerCount})
        </span>
      ) : null}
    </span>
  );
}

export function DashboardViewerFilterPicker({
  viewerOptions,
  selectedViewerNames,
  hiddenSessionCount,
  onToggleViewer,
  onClearViewerFilter,
  className,
}: {
  viewerOptions: DashboardViewerFilterOption[];
  selectedViewerNames: readonly string[];
  hiddenSessionCount: number;
  onToggleViewer: (viewerName: string) => void;
  onClearViewerFilter: () => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const selectedNames = sanitizeDashboardViewerFilterNames(selectedViewerNames);
  const selectedNamesSet = new Set(selectedNames);
  const filterActive = selectedNames.length > 0;
  const reduceMotion = useReducedMotion();
  const microHover = reduceMotion ? undefined : { y: -1 };
  const microTap = reduceMotion ? undefined : { scale: 0.985 };
  const microTransition = reduceMotion
    ? { duration: 0 }
    : cliparrMotionTransitions.fast;
  const queryText = query.trim().toLowerCase();
  const filteredViewerOptions = queryText
    ? viewerOptions.filter((option) =>
        option.name.toLowerCase().includes(queryText),
      )
    : viewerOptions;
  const triggerLabel = dashboardViewerFilterTriggerLabel(
    viewerOptions,
    selectedNames,
  );
  const selectedViewerOptions = selectedDashboardViewerFilterOptions(
    viewerOptions,
    selectedNames,
  );
  const totalSessionCount = viewerOptions.reduce(
    (sum, option) => sum + option.sessionCount,
    0,
  );

  if (viewerOptions.length <= 1 && !filterActive) {
    return null;
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Filter sessions by viewer: ${triggerLabel}`}
        data-dashboard-viewer-filter
        data-dashboard-viewer-filter-active={filterActive || undefined}
        className={(state) =>
          cn(
            "inline-flex h-11 w-full min-w-0 items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-sm font-semibold text-muted-foreground transition-[color,background-color,border-color,transform] duration-200 hover:-translate-y-px hover:bg-accent hover:text-foreground active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none motion-reduce:transform-none sm:h-9 sm:w-52 sm:shrink-0 sm:gap-2 sm:px-3 sm:font-medium",
            state.open &&
              "[&_[data-dashboard-viewer-filter-chevron]]:rotate-180",
            filterActive &&
              "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
            className,
          )
        }
      >
        <Users className="h-4 w-4 shrink-0" />
        <span className="hidden shrink-0 sm:inline">Viewers</span>
        {filterActive ? (
          <>
            <DashboardViewerFilterTriggerSelection
              selectedViewerOptions={selectedViewerOptions}
            />
            <span className="sr-only">{triggerLabel}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-left">All viewers</span>
        )}
        <span
          className="shrink-0 transition-transform duration-200 motion-reduce:transition-none"
          data-dashboard-viewer-filter-chevron
          aria-hidden="true"
        >
          <ChevronDown className="h-4 w-4 opacity-70" />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end">
          <Popover.Popup
            className={cn(
              "z-50 w-[min(calc(100vw-2rem),22rem)] rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg outline-none",
              "data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95",
            )}
            initialFocus={false}
          >
            <div className="px-2 py-1.5">
              <Popover.Title className="text-sm font-semibold text-foreground">
                Filter by viewer
              </Popover.Title>
              <Popover.Description className="mt-0.5 text-xs text-muted-foreground">
                Selected viewers are shown as a whitelist.
              </Popover.Description>
            </div>

            <label className="relative mt-2 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search viewers"
                className="h-9 w-full rounded-md border border-input bg-background px-3 pl-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                data-dashboard-viewer-filter-search
              />
            </label>

            <ScrollArea
              className="mt-2 max-h-72"
              contentClassName="pr-3"
              data-dashboard-viewer-filter-options
              viewportClassName="max-h-72"
            >
              <motion.button
                type="button"
                onClick={onClearViewerFilter}
                aria-pressed={!filterActive}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none",
                  !filterActive && "bg-primary/10 text-primary",
                )}
                whileHover={microHover}
                whileTap={microTap}
                transition={microTransition}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background text-primary">
                  <Users className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    All viewers
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatFilterSessionCount(totalSessionCount)}
                  </span>
                </span>
                <motion.span
                  className={cn(
                    "shrink-0 text-primary",
                    filterActive && "pointer-events-none",
                  )}
                  animate={{
                    opacity: filterActive ? 0 : 1,
                    scale: filterActive ? 0.8 : 1,
                  }}
                  transition={microTransition}
                  aria-hidden="true"
                >
                  <Check className="h-4 w-4" />
                </motion.span>
              </motion.button>

              {filteredViewerOptions.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No viewers found.
                </div>
              ) : (
                filteredViewerOptions.map((option) => {
                  const selected = selectedNamesSet.has(option.normalizedName);
                  const actionLabel = selected
                    ? `Hide ${option.name} sessions`
                    : `Show ${option.name} sessions`;

                  return (
                    <motion.button
                      key={option.normalizedName}
                      type="button"
                      onClick={() => onToggleViewer(option.normalizedName)}
                      aria-pressed={selected}
                      aria-label={actionLabel}
                      className={cn(
                        "mt-1 flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none",
                        selected && "bg-primary/10 text-primary",
                      )}
                      whileHover={microHover}
                      whileTap={microTap}
                      transition={microTransition}
                    >
                      <ViewerAvatar
                        name={option.name}
                        avatarUrl={option.avatarUrl}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {option.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatFilterSessionCount(option.sessionCount)}
                        </span>
                      </span>
                      <motion.span
                        className={cn(
                          "shrink-0 text-primary",
                          !selected && "pointer-events-none",
                        )}
                        animate={{
                          opacity: selected ? 1 : 0,
                          scale: selected ? 1 : 0.8,
                        }}
                        transition={microTransition}
                        aria-hidden="true"
                      >
                        <Check className="h-4 w-4" />
                      </motion.span>
                    </motion.button>
                  );
                })
              )}
            </ScrollArea>

            {filterActive && (
              <div
                className="mt-2 flex items-center justify-between gap-3 border-t border-border px-2 pt-2"
                data-dashboard-viewer-filter-summary
              >
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {hiddenSessionCount > 0
                    ? `${formatFilterSessionCount(hiddenSessionCount)} hidden`
                    : "Filtered"}
                </span>
                <motion.button
                  type="button"
                  onClick={onClearViewerFilter}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none"
                  whileHover={microHover}
                  whileTap={microTap}
                  transition={microTransition}
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </motion.button>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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
        <div className="absolute top-3 right-3 left-3 flex min-w-0">
          <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-card/90 px-2.5 py-1 text-ui-label font-medium tracking-wide text-muted-foreground uppercase shadow-sm backdrop-blur-sm">
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

export function DashboardPlaybackFilterEmptyState({
  hiddenSessionCount,
  onClearViewerFilter,
}: {
  hiddenSessionCount: number;
  onClearViewerFilter: () => void;
}) {
  return (
    <>
      <div className="bg-background mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
        <Users className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mb-2 text-lg font-medium">
        No sessions match this viewer filter
      </h3>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">
        {formatFilterHiddenCount(hiddenSessionCount)}
      </p>
      <button
        type="button"
        onClick={onClearViewerFilter}
        className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none"
      >
        <X className="h-4 w-4" />
        Clear filter
      </button>
    </>
  );
}

function DashboardPlaybackMotionRegion({
  loading,
  error,
  playbackCards,
  filteredByViewer,
  hiddenSessionCount,
  emptyMessage,
  activeViewTransitionSessionId,
  onSelectSession,
  onClearViewerFilter,
}: {
  loading: boolean;
  error: string;
  playbackCards: DashboardPlaybackCardItem[];
  filteredByViewer: boolean;
  hiddenSessionCount: number;
  emptyMessage: string;
  activeViewTransitionSessionId?: string | null;
  onSelectSession: (session: CurrentlyPlayingItem) => void;
  onClearViewerFilter: () => void;
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
                className={cn("h-full min-w-0", className)}
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
                className="h-full min-w-0"
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
            {filteredByViewer && hiddenSessionCount > 0 ? (
              <DashboardPlaybackFilterEmptyState
                hiddenSessionCount={hiddenSessionCount}
                onClearViewerFilter={onClearViewerFilter}
              />
            ) : (
              <>
                <div className="bg-background mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <Play className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="mb-2 text-lg font-medium">
                  Nothing is playing right now
                </h3>
                <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                  {emptyMessage}
                </p>
              </>
            )}
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

export function DashboardVersionBadge({
  latestRelease,
  releaseChecksDisabledReason,
  versionLabel,
}: {
  latestRelease: CliparrVersionInfo["latestRelease"] | null;
  releaseChecksDisabledReason?: string | null;
  versionLabel: string;
}) {
  if (!versionLabel) {
    return (
      <span
        className={cn(DASHBOARD_VERSION_BADGE_CLASS, "invisible")}
        aria-hidden="true"
        data-dashboard-version-badge
      >
        0.0.0
      </span>
    );
  }

  if (!latestRelease) {
    return (
      <span
        className={DASHBOARD_VERSION_BADGE_CLASS}
        title={releaseChecksDisabledReason ?? undefined}
        data-dashboard-version-badge
        data-dashboard-release-check-disabled={
          releaseChecksDisabledReason ? true : undefined
        }
      >
        {versionLabel}
      </span>
    );
  }

  const updateLabel = `${latestRelease.tagName} is available`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={latestRelease.url}
          target="_blank"
          rel="noreferrer"
          className={cn(
            DASHBOARD_VERSION_BADGE_CLASS,
            "gap-1.5 border-primary/40 bg-primary/10 text-primary transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none",
          )}
          aria-label={`${updateLabel}. View release notes.`}
          title={updateLabel}
          data-dashboard-version-badge
          data-dashboard-update-available
        >
          <span>{versionLabel}</span>
          <span
            className="h-1.5 w-1.5 rounded-full bg-primary"
            aria-hidden="true"
            data-dashboard-update-indicator
          />
          <span
            className="text-[11px] leading-none font-medium text-primary/80"
            data-dashboard-update-label
          >
            Update available
          </span>
        </a>
      </TooltipTrigger>
      <TooltipContent side="top" align="start">
        {updateLabel}
      </TooltipContent>
    </Tooltip>
  );
}

export default function DashboardScreen({
  activeViewTransitionSessionId,
  onSelectSession,
  onOpenLocalVideo,
  onOpenSources,
  onDisconnect,
}: Properties) {
  const [viewers, setViewers] = useState<ViewerPlaybackGroup[]>([]);
  const [sourceErrors, setSourceErrors] = useState<SourcePlaybackError[]>([]);
  const [versionInfo, setVersionInfo] = useState<CliparrVersionInfo | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedViewerNames, setSelectedViewerNames] = useState(() =>
    readDashboardViewerFilter(),
  );
  const hasFetchedSessionsReference = useRef(false);
  const reduceDashboardMotion = useReducedMotion();

  const fetchSessions = useCallback(async () => {
    const isInitialFetch = !hasFetchedSessionsReference.current;
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
    } catch (error_: unknown) {
      setError(errorMessage(error_, "Could not load sessions."));
      setViewers([]);
      setSourceErrors([]);
    } finally {
      hasFetchedSessionsReference.current = true;
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
  const selectedViewerFilterNames = useMemo(
    () => sanitizeDashboardViewerFilterNames(selectedViewerNames),
    [selectedViewerNames],
  );
  const viewerFilterOptions = useMemo(
    () => buildDashboardViewerFilterOptions(playbackCards),
    [playbackCards],
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
  const showViewerFilterControl =
    viewerFilterOptions.length > 1 || selectedViewerFilterNames.length > 0;
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
              showViewerFilterControl
                ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.75rem]"
                : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem]",
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
            {renderViewerFilterPicker()}
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
            <motion.button
              type="button"
              onClick={onDisconnect}
              className={cn(
                "flex items-center gap-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none",
                showViewerFilterControl
                  ? "h-9 w-9 justify-center p-2"
                  : "px-4 py-2",
              )}
              aria-label="Disconnect"
              title="Disconnect"
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
              transition={
                reduceDashboardMotion
                  ? { duration: 0 }
                  : cliparrMotionTransitions.fast
              }
            >
              <LogOut className="w-4 h-4" />
              {!showViewerFilterControl && "Disconnect"}
            </motion.button>
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
            playbackCards={filteredPlaybackCards}
            filteredByViewer={selectedViewerFilterNames.length > 0}
            hiddenSessionCount={hiddenViewerFilterCardCount}
            emptyMessage={emptyMessage}
            activeViewTransitionSessionId={activeViewTransitionSessionId}
            onSelectSession={onSelectSession}
            onClearViewerFilter={clearViewerFilter}
          />
        </div>
      </div>
    </div>
  );
}
