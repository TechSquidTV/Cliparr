import type {
  CurrentlyPlayingItem,
  ViewerPlaybackGroup,
} from "@cliparr/shared/providers";
import { Video } from "lucide-react";
import { memo } from "react";

import type { DashboardPlaybackCardItem } from "#/components/dashboard/dashboardPlaybackItems";
import { formatViewerSessionCount } from "#/components/dashboard/dashboardPlaybackItems";
import { DashboardViewerAvatar } from "#/components/dashboard/DashboardViewerAvatar";
import {
  formatProviderName,
  ProviderGlyph,
} from "#/components/providers/ProviderGlyph";
import { cn } from "#/lib/cn";
import { EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME } from "#/lib/viewTransitions";

function looksLikeGeneratedSourceName(value: string) {
  return /^[\da-f]{12,64}$/i.test(value.trim());
}

export function formatDashboardSourceLabel(source: {
  name: string;
  providerId: string;
}) {
  if (!looksLikeGeneratedSourceName(source.name)) {
    return source.name;
  }

  return formatProviderName(source.providerId);
}

function canEditSession(
  session: Pick<CurrentlyPlayingItem, "mediaUrl" | "hlsUrl">,
) {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- An empty URL does not make a session editable.
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
      <DashboardViewerAvatar
        name={viewer.name}
        avatarUrl={viewer.avatarUrl}
        size="sm"
      />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">
          {viewer.name}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          <span className="capitalize">{playerState}</span>
          {sessionCount > 1 && ` (${formatViewerSessionCount(sessionCount)})`}
        </div>
      </div>
    </div>
  );
}

export const DashboardPlaybackCard = memo(function DashboardPlaybackCard({
  session: mediaSession,
  viewer,
  viewerSessionCount,
  activeViewTransitionSessionId,
  onSelectSession,
}: DashboardPlaybackCardItem & {
  activeViewTransitionSessionId?: string | null;
  onSelectSession: (session: CurrentlyPlayingItem) => void;
}) {
  const canEdit = canEditSession(mediaSession);
  const sourceLabel = formatDashboardSourceLabel(mediaSession.source);
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

export function DashboardPlaybackCardSkeleton({
  className,
}: {
  className?: string;
}) {
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
