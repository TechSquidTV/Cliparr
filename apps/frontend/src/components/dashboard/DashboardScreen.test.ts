import assert from "node:assert/strict";
import test from "node:test";

import type { ViewerPlaybackGroup } from "@cliparr/shared/providers";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DashboardMobileMenu } from "#/components/dashboard/DashboardMobileMenu";
import { DashboardPlaybackCard } from "#/components/dashboard/DashboardPlaybackCard";
import {
  activeDashboardViewerFilterNames,
  buildDashboardViewerFilterOptions,
  canUseDashboardViewerFilter,
  countDashboardViewerFilterHiddenCards,
  DASHBOARD_VIEWER_FILTER_STORAGE_KEY,
  filterDashboardPlaybackCardsByViewer,
  flattenDashboardPlaybackItems,
  formatViewerSessionCount,
  parseDashboardViewerFilterStorageValue,
  readDashboardViewerFilter,
  sanitizeDashboardViewerFilterNames,
  writeDashboardViewerFilter,
} from "#/components/dashboard/dashboardPlaybackItems";
import DashboardScreen from "#/components/dashboard/DashboardScreen";
import { DashboardVersionBadge } from "#/components/dashboard/DashboardVersionBadge";
import {
  DashboardPlaybackFilterEmptyState,
  DashboardViewerFilterPicker,
} from "#/components/dashboard/DashboardViewerFilter";
import { TooltipProvider } from "#/components/ui/tooltip";

const dashboardPlaybackGroups: ViewerPlaybackGroup[] = [
  {
    viewer: {
      id: "viewer-a",
      providerId: "plex",
      name: "TechSquidTV",
    },
    items: [
      {
        id: "session-a",
        source: {
          id: "source-a",
          name: "Plex",
          providerId: "plex",
        },
        title: "The Recordist",
        type: "episode",
        duration: 3600,
        playerTitle: "Living Room",
        playerState: "playing",
      },
    ],
  },
  {
    viewer: {
      id: "viewer-b",
      providerId: "jellyfin",
      name: "Guest",
    },
    items: [
      {
        id: "session-b",
        source: {
          id: "source-b",
          name: "Jellyfin",
          providerId: "jellyfin",
        },
        title: "Example Movie",
        type: "movie",
        duration: 5400,
        playerTitle: "Phone",
        playerState: "paused",
      },
    ],
  },
];

const dashboardDuplicateViewerPlaybackGroups: ViewerPlaybackGroup[] = [
  ...dashboardPlaybackGroups,
  {
    viewer: {
      id: "viewer-c",
      providerId: "jellyfin",
      name: " techsquidtv ",
      avatarUrl: "/api/media/avatar.jpg",
    },
    items: [
      {
        id: "session-c",
        source: {
          id: "source-c",
          name: "Jellyfin",
          providerId: "jellyfin",
        },
        title: "Same Viewer Across Providers",
        type: "episode",
        duration: 1800,
        playerTitle: "Bedroom",
        playerState: "playing",
      },
    ],
  },
];

const dashboardMusicPlaybackGroups: ViewerPlaybackGroup[] = [
  {
    viewer: {
      id: "viewer-music",
      providerId: "plex",
      name: "Music Listener",
    },
    items: [
      {
        id: "session-music",
        source: {
          id: "source-music",
          name: "Plex",
          providerId: "plex",
        },
        title: "A Square Album Cover",
        type: "track",
        duration: 240,
        playerTitle: "Office Speaker",
        playerState: "playing",
        thumbUrl: "/api/media/music-thumb.jpg",
        hlsUrl: "/api/media/music.m3u8",
      },
    ],
  },
];

void test("renders dashboard mobile menu trigger", () => {
  const markup = renderToStaticMarkup(
    createElement(DashboardMobileMenu, {
      appVersion: "1.2.3",
      latestRelease: null,
      onDisconnect: () => {},
    }),
  );

  assert.match(markup, /Open dashboard menu/);
});

void test("renders dashboard version badge as a release link when an update is available", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(DashboardVersionBadge, {
        versionLabel: "v1.2.3",
        latestRelease: {
          tagName: "v1.3.0",
          url: "https://github.com/TechSquidTV/Cliparr/releases/tag/v1.3.0",
          publishedAt: "2026-06-04T10:30:00.000Z",
        },
      }),
    ),
  );

  assert.match(markup, /data-dashboard-version-badge/);
  assert.match(markup, /data-dashboard-update-available/);
  assert.match(markup, /data-dashboard-update-indicator/);
  assert.match(markup, /data-dashboard-update-label/);
  assert.match(markup, /Update available/);
  assert.match(markup, /v1\.3\.0 is available/);
});

void test("renders dashboard dev version badge with disabled update checks", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(DashboardVersionBadge, {
        versionLabel: "dev",
        latestRelease: null,
        releaseChecksDisabledReason:
          "Local development build; release update checks are disabled",
      }),
    ),
  );

  assert.match(markup, /data-dashboard-version-badge/);
  assert.match(markup, /data-dashboard-release-check-disabled="true"/);
  assert.match(markup, />dev</);
  assert.match(markup, /tabindex="0"/);
  assert.doesNotMatch(markup, / title=/);
});

void test("reserves dashboard playback card space before sessions load", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(DashboardScreen, {
        activeViewTransitionSessionId: null,
        onSelectSession: () => {},
        onOpenLocalVideo: () => {},
        onOpenSources: () => {},
        onDisconnect: () => {},
      }),
    ),
  );

  assert.match(markup, /data-dashboard-loading-grid/);
  assert.match(markup, /data-dashboard-playback-motion/);
  assert.match(markup, /data-dashboard-loading-items="3"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /aria-label="Loading currently playing sessions"/);
  assert.match(markup, /data-dashboard-playback-skeleton/);
  assert.match(markup, /aspect-\[2\/3]/);
});

void test("reserves dashboard version badge space before health loads", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(DashboardScreen, {
        activeViewTransitionSessionId: null,
        onSelectSession: () => {},
        onOpenLocalVideo: () => {},
        onOpenSources: () => {},
        onDisconnect: () => {},
      }),
    ),
  );

  assert.match(markup, /data-dashboard-version-badge/);
  assert.match(markup, /invisible/);
});

void test("flattens dashboard playback cards with viewer context", () => {
  const cards = flattenDashboardPlaybackItems(dashboardPlaybackGroups);

  assert.deepEqual(
    cards.map((card) => [
      card.viewer.name,
      card.viewerSessionCount,
      card.session.title,
    ]),
    [
      ["TechSquidTV", 1, "The Recordist"],
      ["Guest", 1, "Example Movie"],
    ],
  );
  assert.equal(formatViewerSessionCount(1), "1 active session");
  assert.equal(formatViewerSessionCount(2), "2 active sessions");
});

void test("groups dashboard viewer filter options by normalized viewer name", () => {
  const cards = flattenDashboardPlaybackItems(
    dashboardDuplicateViewerPlaybackGroups,
  );
  const options = buildDashboardViewerFilterOptions(cards);

  assert.deepEqual(
    options.map((option) => [
      option.normalizedName,
      option.name,
      option.sessionCount,
      option.avatarUrl,
    ]),
    [
      ["techsquidtv", "TechSquidTV", 2, "/api/media/avatar.jpg"],
      ["guest", "Guest", 1, undefined],
    ],
  );
});

void test("filters dashboard playback cards by multiple viewer names", () => {
  const cards = flattenDashboardPlaybackItems(
    dashboardDuplicateViewerPlaybackGroups,
  );

  assert.deepEqual(
    sanitizeDashboardViewerFilterNames([
      " TechSquidTV ",
      "techsquidtv",
      "GUEST",
    ]),
    ["techsquidtv", "guest"],
  );

  const techSquidCards = filterDashboardPlaybackCardsByViewer(cards, [
    "TechSquidTV",
  ]);
  assert.deepEqual(
    techSquidCards.map((card) => card.session.title),
    ["The Recordist", "Same Viewer Across Providers"],
  );

  const multiViewerCards = filterDashboardPlaybackCardsByViewer(cards, [
    "techsquidtv",
    "guest",
  ]);
  assert.equal(multiViewerCards.length, cards.length);
  assert.equal(countDashboardViewerFilterHiddenCards(cards, ["missing"]), 3);
});

void test("persists dashboard viewer filters in local storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  } satisfies Pick<Storage, "getItem" | "removeItem" | "setItem">;

  assert.deepEqual(parseDashboardViewerFilterStorageValue("not-json"), []);
  writeDashboardViewerFilter([" TechSquidTV ", "Guest", "guest"], storage);
  assert.equal(
    values.get(DASHBOARD_VIEWER_FILTER_STORAGE_KEY),
    '["techsquidtv","guest"]',
  );
  assert.deepEqual(readDashboardViewerFilter(storage), [
    "techsquidtv",
    "guest",
  ]);

  writeDashboardViewerFilter([], storage);
  assert.equal(values.has(DASHBOARD_VIEWER_FILTER_STORAGE_KEY), false);
});

void test("hides dashboard viewer filter with one viewer and no active filter", () => {
  const options = buildDashboardViewerFilterOptions(
    flattenDashboardPlaybackItems([dashboardPlaybackGroups[0]!]),
  );

  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(DashboardViewerFilterPicker, {
        viewerOptions: options,
        selectedViewerNames: [],
        hiddenSessionCount: 0,
        onToggleViewer: () => {},
        onClearViewerFilter: () => {},
      }),
    ),
  );

  assert.equal(markup, "");
});

void test("ignores saved dashboard viewer filters until multiple viewers are available", () => {
  const oneViewerOptions = buildDashboardViewerFilterOptions(
    flattenDashboardPlaybackItems([dashboardPlaybackGroups[0]!]),
  );
  const multipleViewerOptions = buildDashboardViewerFilterOptions(
    flattenDashboardPlaybackItems(dashboardPlaybackGroups),
  );

  assert.equal(canUseDashboardViewerFilter(oneViewerOptions), false);
  assert.deepEqual(
    activeDashboardViewerFilterNames(oneViewerOptions, [
      "TechSquidTV",
      "Guest",
    ]),
    [],
  );

  assert.equal(canUseDashboardViewerFilter(multipleViewerOptions), true);
  assert.deepEqual(
    activeDashboardViewerFilterNames(multipleViewerOptions, [
      " TechSquidTV ",
      "GUEST",
    ]),
    ["techsquidtv", "guest"],
  );
});

void test("hides dashboard viewer filter with one viewer and saved choices", () => {
  const options = buildDashboardViewerFilterOptions(
    flattenDashboardPlaybackItems([dashboardPlaybackGroups[0]!]),
  );

  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(DashboardViewerFilterPicker, {
        viewerOptions: options,
        selectedViewerNames: ["techsquidtv", "guest"],
        hiddenSessionCount: 0,
        onToggleViewer: () => {},
        onClearViewerFilter: () => {},
      }),
    ),
  );

  assert.equal(markup, "");
});

void test("renders dashboard viewer filter options for multiple viewers", () => {
  const options = buildDashboardViewerFilterOptions(
    flattenDashboardPlaybackItems(dashboardPlaybackGroups),
  );

  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(DashboardViewerFilterPicker, {
        viewerOptions: options,
        selectedViewerNames: [],
        hiddenSessionCount: 0,
        onToggleViewer: () => {},
        onClearViewerFilter: () => {},
      }),
    ),
  );

  assert.match(markup, /data-dashboard-viewer-filter/);
  assert.match(markup, /sm:w-52/);
  assert.match(markup, /Filter sessions by viewer: All viewers/);
  assert.match(markup, /All viewers/);
});

void test("renders dashboard viewer filter as active from saved choices", () => {
  const options = buildDashboardViewerFilterOptions(
    flattenDashboardPlaybackItems(dashboardPlaybackGroups),
  );

  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(DashboardViewerFilterPicker, {
        viewerOptions: options,
        selectedViewerNames: ["techsquidtv"],
        hiddenSessionCount: 0,
        onToggleViewer: () => {},
        onClearViewerFilter: () => {},
      }),
    ),
  );

  assert.match(markup, /data-dashboard-viewer-filter-active="true"/);
  assert.match(markup, /data-dashboard-viewer-filter-selected-avatars/);
  assert.match(markup, /Filter sessions by viewer: TechSquidTV/);
  assert.match(markup, /TechSquidTV/);
});

void test("labels dashboard viewer filter with saved viewer absent from active sessions", () => {
  const options = buildDashboardViewerFilterOptions(
    flattenDashboardPlaybackItems(dashboardPlaybackGroups),
  );

  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(DashboardViewerFilterPicker, {
        viewerOptions: options,
        selectedViewerNames: ["saved-viewer"],
        hiddenSessionCount: 0,
        onToggleViewer: () => {},
        onClearViewerFilter: () => {},
      }),
    ),
  );

  assert.match(markup, /data-dashboard-viewer-filter-active="true"/);
  assert.match(markup, /Filter sessions by viewer: saved-viewer/);
});

void test("summarizes multiple selected dashboard viewers in the picker trigger", () => {
  const options = buildDashboardViewerFilterOptions(
    flattenDashboardPlaybackItems(dashboardPlaybackGroups),
  );

  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(DashboardViewerFilterPicker, {
        viewerOptions: options,
        selectedViewerNames: ["techsquidtv", "guest"],
        hiddenSessionCount: 0,
        onToggleViewer: () => {},
        onClearViewerFilter: () => {},
      }),
    ),
  );

  assert.match(markup, /Filter sessions by viewer: 2 viewers/);
  assert.match(markup, /data-dashboard-viewer-filter-selected-avatars/);
});

void test("renders dashboard viewer filter selected avatars with overflow count", () => {
  const viewerOptions = Array.from({ length: 5 }, (_, index) => {
    const viewerNumber = index + 1;

    return {
      normalizedName: `viewer-${viewerNumber}`,
      name: `Viewer ${viewerNumber}`,
      avatarUrl: `/api/media/avatar-${viewerNumber}.jpg`,
      sessionCount: 1,
    };
  });

  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(DashboardViewerFilterPicker, {
        viewerOptions,
        selectedViewerNames: viewerOptions.map(
          (option) => option.normalizedName,
        ),
        hiddenSessionCount: 0,
        onToggleViewer: () => {},
        onClearViewerFilter: () => {},
      }),
    ),
  );

  assert.match(markup, /Filter sessions by viewer: 5 viewers/);
  assert.match(markup, /data-dashboard-viewer-filter-selected-avatars/);
  assert.match(markup, /data-dashboard-viewer-filter-overflow-count/);
  assert.match(markup, /-space-x-2/);
  assert.match(markup, /bg-background ring-2 ring-background/);
  assert.match(markup, /style="z-index:1".*style="z-index:2"/);
  assert.match(markup, /\(\+3\)/);
});

void test("renders dashboard filtered empty state with a clear action", () => {
  const markup = renderToStaticMarkup(
    createElement(DashboardPlaybackFilterEmptyState, {
      hiddenSessionCount: 2,
      onClearViewerFilter: () => {},
    }),
  );

  assert.match(markup, /No sessions match this viewer filter/);
  assert.match(markup, /2 sessions are hidden by the viewer filter/);
  assert.match(markup, /Clear filter/);
});

void test("renders dashboard playback cards with viewer context", () => {
  const card = flattenDashboardPlaybackItems(dashboardPlaybackGroups)[0];
  assert.ok(card);

  for (const viewerSessionCount of [1, 2]) {
    const markup = renderToStaticMarkup(
      createElement(DashboardPlaybackCard, {
        ...card,
        viewerSessionCount,
        activeViewTransitionSessionId: null,
        onSelectSession: () => {},
      }),
    );

    assert.match(markup, /TechSquidTV/);
    assert.match(markup, /playing/);
    if (viewerSessionCount === 1) {
      assert.doesNotMatch(markup, /1 active session/);
    } else {
      assert.match(markup, /\(2 active sessions\)/);
    }
    assert.match(markup, /Living Room/);
    assert.match(markup, /h-full w-full flex-col/);
    assert.match(markup, /aspect-\[2\/3]/);
    assert.match(markup, /mt-auto/);
  }
});

void test("renders music playback cards inside the video-style card frame", () => {
  const card = flattenDashboardPlaybackItems(dashboardMusicPlaybackGroups)[0];
  assert.ok(card);

  const markup = renderToStaticMarkup(
    createElement(DashboardPlaybackCard, {
      ...card,
      activeViewTransitionSessionId: null,
      onSelectSession: () => {},
    }),
  );

  assert.match(markup, /A Square Album Cover/);
  assert.match(markup, /TRACK/);
  assert.match(
    markup,
    /relative aspect-\[2\/3] w-full shrink-0 overflow-hidden/,
  );
  assert.match(markup, /absolute inset-0 h-full w-full object-cover/);
  assert.match(markup, /mt-auto/);
});
