import type {
  CurrentlyPlayingItem,
  ViewerPlaybackGroup,
} from "@/providers/types";

type DashboardPlaybackViewer = ViewerPlaybackGroup["viewer"];

export interface DashboardPlaybackCardItem {
  session: CurrentlyPlayingItem;
  viewer: DashboardPlaybackViewer;
  viewerSessionCount: number;
}

export function flattenDashboardPlaybackItems(
  viewers: ViewerPlaybackGroup[],
): DashboardPlaybackCardItem[] {
  return viewers.flatMap((viewerGroup) =>
    viewerGroup.items.map((session) => ({
      session,
      viewer: viewerGroup.viewer,
      viewerSessionCount: viewerGroup.items.length,
    })),
  );
}

export function formatViewerSessionCount(count: number) {
  return `${count} active ${count === 1 ? "session" : "sessions"}`;
}
