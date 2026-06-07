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

export interface DashboardViewerFilterOption {
  normalizedName: string;
  name: string;
  avatarUrl?: string;
  sessionCount: number;
}

type DashboardViewerFilterStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export const DASHBOARD_VIEWER_FILTER_STORAGE_KEY =
  "cliparr.dashboard.viewer-filter.v1";

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

function normalizeDashboardViewerName(value: string) {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

export function sanitizeDashboardViewerFilterNames(values: readonly unknown[]) {
  const names = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const normalizedName = normalizeDashboardViewerName(value);
    if (normalizedName) {
      names.add(normalizedName);
    }
  }

  return [...names];
}

export function buildDashboardViewerFilterOptions(
  cards: DashboardPlaybackCardItem[],
): DashboardViewerFilterOption[] {
  const options = new Map<string, DashboardViewerFilterOption>();

  for (const card of cards) {
    const normalizedName = normalizeDashboardViewerName(card.viewer.name);
    if (!normalizedName) {
      continue;
    }

    const existing = options.get(normalizedName);
    if (existing) {
      existing.sessionCount += 1;
      existing.avatarUrl ||= card.viewer.avatarUrl;
      continue;
    }

    options.set(normalizedName, {
      normalizedName,
      name: card.viewer.name.trim(),
      avatarUrl: card.viewer.avatarUrl,
      sessionCount: 1,
    });
  }

  return [...options.values()];
}

export function filterDashboardPlaybackCardsByViewer(
  cards: DashboardPlaybackCardItem[],
  selectedViewerNames: readonly string[],
) {
  const selectedNames = sanitizeDashboardViewerFilterNames(selectedViewerNames);
  if (selectedNames.length === 0) {
    return cards;
  }

  const selectedNamesSet = new Set(selectedNames);

  return cards.filter((card) =>
    selectedNamesSet.has(normalizeDashboardViewerName(card.viewer.name)),
  );
}

export function countDashboardViewerFilterHiddenCards(
  cards: DashboardPlaybackCardItem[],
  selectedViewerNames: readonly string[],
) {
  const selectedNames = sanitizeDashboardViewerFilterNames(selectedViewerNames);
  if (selectedNames.length === 0) {
    return 0;
  }

  return (
    cards.length -
    filterDashboardPlaybackCardsByViewer(cards, selectedNames).length
  );
}

function safeDashboardViewerFilterStorage():
  | DashboardViewerFilterStorage
  | undefined {
  try {
    if (globalThis.window === undefined) {
      return undefined;
    }

    const storage = globalThis.window.localStorage;
    return typeof storage?.getItem === "function" &&
      typeof storage.setItem === "function" &&
      typeof storage.removeItem === "function"
      ? storage
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseDashboardViewerFilterStorageValue(raw: string | null) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? sanitizeDashboardViewerFilterNames(parsed)
      : [];
  } catch {
    return [];
  }
}

export function readDashboardViewerFilter(
  storage = safeDashboardViewerFilterStorage(),
) {
  if (!storage) {
    return [];
  }

  try {
    return parseDashboardViewerFilterStorageValue(
      storage.getItem(DASHBOARD_VIEWER_FILTER_STORAGE_KEY),
    );
  } catch {
    return [];
  }
}

export function writeDashboardViewerFilter(
  selectedViewerNames: readonly string[],
  storage = safeDashboardViewerFilterStorage(),
) {
  if (!storage) {
    return;
  }

  const names = sanitizeDashboardViewerFilterNames(selectedViewerNames);

  try {
    if (names.length === 0) {
      storage.removeItem(DASHBOARD_VIEWER_FILTER_STORAGE_KEY);
      return;
    }

    storage.setItem(DASHBOARD_VIEWER_FILTER_STORAGE_KEY, JSON.stringify(names));
  } catch {
    // Best-effort persistence only.
  }
}
