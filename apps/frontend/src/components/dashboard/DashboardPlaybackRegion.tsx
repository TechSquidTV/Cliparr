import type { CurrentlyPlayingItem } from "@cliparr/shared/providers";
import { FolderOpen, Play, Settings2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import {
  DashboardPlaybackCard,
  DashboardPlaybackCardSkeleton,
} from "#/components/dashboard/DashboardPlaybackCard";
import type { DashboardPlaybackCardItem } from "#/components/dashboard/dashboardPlaybackItems";
import { DashboardPlaybackFilterEmptyState } from "#/components/dashboard/DashboardViewerFilter";
import { buttonClassName } from "#/components/ui/control-styles";
import { EmptyState } from "#/components/ui/empty-state";
import { cn } from "#/lib/cn";
import { motionTransitionFor } from "#/lib/motion";

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

export function DashboardPlaybackMotionRegion({
  loading,
  error,
  playbackCards,
  filteredByViewer,
  hiddenSessionCount,
  emptyMessage,
  activeViewTransitionSessionId,
  onSelectSession,
  onClearViewerFilter,
  onOpenLocalVideo,
  onOpenSources,
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
  onOpenLocalVideo: () => void;
  onOpenSources: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const hasPlaybackCards = playbackCards.length > 0;
  const stateTransition = motionTransitionFor("standard", reduceMotion);
  const exitTransition = motionTransitionFor("fast", reduceMotion);
  const layoutTransition = motionTransitionFor("layout", reduceMotion);

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

        {!loading && hasPlaybackCards && (
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
                  session={card.session}
                  viewer={card.viewer}
                  viewerSessionCount={card.viewerSessionCount}
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
              <EmptyState
                icon={<Play className="h-5 w-5" />}
                title="Nothing is playing right now"
                description={emptyMessage}
              >
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                  Start a video in Plex or Jellyfin and it will appear here
                  automatically. If your server is missing, check your connected
                  sources.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={onOpenSources}
                    className={buttonClassName({
                      tone: "secondary",
                      size: "compact",
                    })}
                  >
                    <Settings2 className="h-4 w-4" />
                    Manage sources
                  </button>
                  <button
                    type="button"
                    onClick={onOpenLocalVideo}
                    className={buttonClassName({
                      tone: "secondary",
                      size: "compact",
                    })}
                  >
                    <FolderOpen className="h-4 w-4" />
                    Open Video
                  </button>
                </div>
              </EmptyState>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
