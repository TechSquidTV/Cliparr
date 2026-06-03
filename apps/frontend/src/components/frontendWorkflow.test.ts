/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { createElement, createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  flattenDashboardPlaybackItems,
  formatViewerSessionCount,
} from "@/components/dashboardPlaybackItems";
import AuthCompleteScreen from "@/components/AuthCompleteScreen";
import { DashboardPlaybackCard } from "@/components/DashboardScreen";
import DashboardScreen from "@/components/DashboardScreen";
import { DashboardMobileMenu } from "@/components/DashboardMobileMenu";
import { EditorControls } from "@/components/editor/EditorControls";
import { EditorExportDialog } from "@/components/editor/EditorExportDialog";
import { EditorFramegrabDialog } from "@/components/editor/EditorFramegrabDialog";
import { EditorHeader } from "@/components/editor/EditorHeader";
import { EditorPreview } from "@/components/editor/EditorPreview";
import { LocalVideoOpenDialog } from "@/components/local-media/LocalVideoOpenDialog";
import ProviderConnectScreen from "@/components/provider-connect/ProviderConnectScreen";
import {
  MobilePwaInstallNudge,
  MobilePwaInstallNudgeCard,
} from "@/components/MobilePwaInstallNudge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { gifExportSettingsForPreset } from "@/lib/exportTypes";
import {
  COARSE_POINTER_MEDIA_QUERY,
  MOBILE_INSTALL_MEDIA_QUERY,
} from "@/lib/pwa";
import { EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME } from "@/lib/viewTransitions";
import type { ViewerPlaybackGroup } from "@/providers/types";

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

function renderExportDialogMarkup(
  overrides: Partial<ComponentProps<typeof EditorExportDialog>> = {},
) {
  const props = {
    isOpen: true,
    title: "Example Movie",
    clipStart: 10,
    clipEnd: 20,
    selectedFormat: "mp4",
    onFormatChange: () => undefined,
    selectedGifPreset: "balanced",
    onGifPresetChange: () => undefined,
    gifSettings: null,
    outputSizeEstimate: { bytes: 7_029_750, basis: "codec-heuristic" },
    selectedResolution: "original",
    onResolutionChange: () => undefined,
    selectedSourcePreference: "auto",
    onSourcePreferenceChange: () => undefined,
    includeAudio: true,
    onIncludeAudioChange: () => undefined,
    audioDisabledReason: null,
    exporting: false,
    progress: 0,
    error: null,
    fileNamePreview: "Example Movie [00m10s-00m20s].mp4",
    outputDimensions: { width: 1920, height: 1080 },
    hasHlsSource: true,
    hasDirectSource: true,
    directSourceLabel: "Direct/original",
    hlsSourceLabel: "HLS playback",
    exportSourceLabel: "Auto: HLS playback",
    exportSourceMessage: null,
    exportSourceSummaryMessage: null,
    subtitleSummaryLabel: "Off",
    subtitleSummaryDetail: "No subtitles will be burned in.",
    subtitleSummaryTone: "muted",
    exportDisabledReason: null,
    activeTemplateKind: "movie",
    editingTemplateKind: "movie",
    onEditingTemplateKindChange: () => undefined,
    fileNameTemplates: {
      movie: "{title} [{start}-{end}]",
      episode: "{series} - {episodeTitle} [{start}-{end}]",
    },
    onFileNameTemplateChange: () => undefined,
    onResetFileNameTemplate: () => undefined,
    onClose: () => undefined,
    onExport: () => undefined,
    ...overrides,
  } satisfies ComponentProps<typeof EditorExportDialog>;

  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EditorExportDialog, props),
    ),
  );
}

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

function restoreGlobalProperty(
  name: string,
  descriptor: PropertyDescriptor | undefined,
) {
  const globalObject = globalThis as typeof globalThis &
    Record<string, unknown>;

  if (descriptor) {
    Object.defineProperty(globalObject, name, descriptor);
    return;
  }

  delete globalObject[name];
}

function withMobilePwaBrowserEnvironment(callback: () => void) {
  const globalObject = globalThis as typeof globalThis &
    Record<string, unknown>;
  const previousWindow = Object.getOwnPropertyDescriptor(
    globalObject,
    "window",
  );
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalObject,
    "navigator",
  );
  const previousLocalStorage = Object.getOwnPropertyDescriptor(
    globalObject,
    "localStorage",
  );
  const matchingQueries = new Set([
    COARSE_POINTER_MEDIA_QUERY,
    MOBILE_INSTALL_MEDIA_QUERY,
  ]);
  const localStorage = {
    length: 0,
    clear() {
      return undefined;
    },
    getItem() {
      return null;
    },
    key() {
      return null;
    },
    removeItem() {
      return undefined;
    },
    setItem() {
      return undefined;
    },
  } satisfies Storage;

  Object.defineProperty(globalObject, "window", {
    configurable: true,
    value: {
      addEventListener() {
        return undefined;
      },
      isSecureContext: true,
      matchMedia(query: string): MediaQueryList {
        return {
          addEventListener() {
            return undefined;
          },
          addListener() {
            return undefined;
          },
          dispatchEvent() {
            return false;
          },
          matches: matchingQueries.has(query),
          media: query,
          onchange: null,
          removeEventListener() {
            return undefined;
          },
          removeListener() {
            return undefined;
          },
        };
      },
      removeEventListener() {
        return undefined;
      },
    },
  });
  Object.defineProperty(globalObject, "navigator", {
    configurable: true,
    value: {
      maxTouchPoints: 5,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
    },
  });
  Object.defineProperty(globalObject, "localStorage", {
    configurable: true,
    value: localStorage,
  });

  try {
    callback();
  } finally {
    restoreGlobalProperty("window", previousWindow);
    restoreGlobalProperty("navigator", previousNavigator);
    restoreGlobalProperty("localStorage", previousLocalStorage);
  }
}

void test("renders the provider auth completion screen", () => {
  const markup = renderToStaticMarkup(createElement(AuthCompleteScreen));

  assert.match(markup, /Plex sign-in finished/);
  assert.match(markup, /Close this tab/);
});

void test("renders local video dialog file picker workflow", () => {
  const markup = renderToStaticMarkup(
    createElement(LocalVideoOpenDialog, {
      isOpen: true,
      onClose: () => undefined,
      onOpened: () => undefined,
    }),
  );

  assert.match(markup, /Open Video/);
  assert.match(markup, /Local files stay in your browser/);
  assert.match(markup, /Choose File/);
});

void test("reserves provider connect layout before providers load", () => {
  const markup = renderToStaticMarkup(
    createElement(ProviderConnectScreen, {
      onConnected: () => undefined,
      onOpenLocalVideo: () => undefined,
    }),
  );

  assert.match(markup, /data-provider-connect-loading-layout/);
  assert.match(markup, /data-provider-connect-selected-skeleton/);
});

void test("renders dashboard mobile menu trigger", () => {
  const markup = renderToStaticMarkup(
    createElement(DashboardMobileMenu, {
      appVersion: "1.2.3",
      onLogout: () => undefined,
    }),
  );

  assert.match(markup, /Open dashboard menu/);
});

void test("renders mobile PWA install nudge for native install state", () => {
  const markup = renderToStaticMarkup(
    createElement(MobilePwaInstallNudgeCard, {
      mode: "native",
      onDismiss: () => undefined,
      onInstall: () => undefined,
    }),
  );

  assert.match(markup, /Add Cliparr to your home screen/);
  assert.match(markup, /data-pwa-install-mode="native"/);
  assert.match(markup, />Install</);
});

void test("hides mobile PWA install nudge by default", () => {
  const markup = renderToStaticMarkup(
    createElement(MobilePwaInstallNudgeCard, {
      mode: "hidden",
      onDismiss: () => undefined,
      onInstall: () => undefined,
    }),
  );

  assert.equal(markup, "");
});

void test("does not render dashboard PWA nudge in default server markup", () => {
  const markup = renderToStaticMarkup(
    createElement(DashboardScreen, {
      activeViewTransitionSessionId: null,
      onSelectSession: () => undefined,
      onOpenLocalVideo: () => undefined,
      onOpenSources: () => undefined,
      onLogout: () => undefined,
    }),
  );

  assert.doesNotMatch(markup, /Add Cliparr to your home screen/);
});

void test("reserves dashboard playback card space before sessions load", () => {
  const markup = renderToStaticMarkup(
    createElement(DashboardScreen, {
      activeViewTransitionSessionId: null,
      onSelectSession: () => undefined,
      onOpenLocalVideo: () => undefined,
      onOpenSources: () => undefined,
      onLogout: () => undefined,
    }),
  );

  assert.match(markup, /data-dashboard-loading-grid/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /aria-label="Loading currently playing sessions"/);
  assert.match(markup, /data-dashboard-playback-skeleton/);
  assert.match(markup, /aspect-\[2\/3\]/);
});

void test("reserves dashboard version badge space before health loads", () => {
  const markup = renderToStaticMarkup(
    createElement(DashboardScreen, {
      activeViewTransitionSessionId: null,
      onSelectSession: () => undefined,
      onOpenLocalVideo: () => undefined,
      onOpenSources: () => undefined,
      onLogout: () => undefined,
    }),
  );

  assert.match(markup, /data-dashboard-version-badge/);
  assert.match(markup, /invisible/);
});

void test("renders mobile PWA install nudge on the initial eligible browser pass", () => {
  withMobilePwaBrowserEnvironment(() => {
    const markup = renderToStaticMarkup(createElement(MobilePwaInstallNudge));

    assert.match(markup, /Add Cliparr to your home screen/);
    assert.match(markup, /data-pwa-install-mode="ios"/);
  });
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

void test("renders dashboard playback cards with viewer context", () => {
  const card = flattenDashboardPlaybackItems(dashboardPlaybackGroups)[0];
  assert.ok(card);

  const markup = renderToStaticMarkup(
    createElement(DashboardPlaybackCard, {
      card,
      activeViewTransitionSessionId: null,
      onSelectSession: () => undefined,
    }),
  );

  assert.match(markup, /TechSquidTV/);
  assert.match(markup, /playing/);
  assert.match(markup, /1 active session/);
  assert.match(markup, /Living Room/);
  assert.match(markup, /aspect-\[2\/3\]/);
  assert.match(markup, /mt-auto/);
});

void test("renders music playback cards inside the video-style card frame", () => {
  const card = flattenDashboardPlaybackItems(dashboardMusicPlaybackGroups)[0];
  assert.ok(card);

  const markup = renderToStaticMarkup(
    createElement(DashboardPlaybackCard, {
      card,
      activeViewTransitionSessionId: null,
      onSelectSession: () => undefined,
    }),
  );

  assert.match(markup, /A Square Album Cover/);
  assert.match(markup, /TRACK/);
  assert.match(
    markup,
    /relative aspect-\[2\/3\] w-full shrink-0 overflow-hidden/,
  );
  assert.match(markup, /absolute inset-0 h-full w-full object-cover/);
  assert.match(markup, /mt-auto/);
});

void test("renders the editor thumbnail behind loading preview state", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorPreview, {
      canvasRef: createRef<HTMLCanvasElement>(),
      playing: false,
      loadingPreview: true,
      loadingPreviewFrame: false,
      posterImageUrl: "/api/media/thumb.jpg",
      previewStatus: "Loading HLS stream...",
      previewFrameStatus: "",
      togglePlay: () => undefined,
    }),
  );

  assert.match(markup, /\/api\/media\/thumb\.jpg/);
  assert.match(markup, /blur-sm/);
  assert.match(markup, /transition-opacity/);
  assert.match(markup, /opacity-75/);
  assert.match(markup, /Loading HLS stream/);
});

void test("keeps the editor thumbnail mounted after preview load for fade out", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorPreview, {
      canvasRef: createRef<HTMLCanvasElement>(),
      playing: false,
      loadingPreview: false,
      loadingPreviewFrame: false,
      posterImageUrl: "/api/media/thumb.jpg",
      previewStatus: "Loading HLS stream...",
      previewFrameStatus: "",
      togglePlay: () => undefined,
    }),
  );

  assert.match(markup, /\/api\/media\/thumb\.jpg/);
  assert.match(markup, /transition-opacity/);
  assert.match(markup, /opacity-0/);
});

void test("renders mobile editor controls trigger and compact range summary", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EditorControls, {
        variant: "mobile",
        playing: false,
        loadingPreview: false,
        togglePlay: () => undefined,
        currentTime: 12,
        duration: 120,
        startTime: 10,
        endTime: 20,
        muted: false,
        setMuted: () => undefined,
        volume: 1,
        setVolume: () => undefined,
        handleTimelineZoomIn: () => undefined,
        handleTimelineZoomOut: () => undefined,
        canZoomIn: true,
        canZoomOut: true,
        onFramegrabClick: () => undefined,
        framegrabDisabledReason: null,
        onPreviewTimeCommit: () => undefined,
        onStartTimeCommit: () => undefined,
        onEndTimeCommit: () => undefined,
      }),
    ),
  );

  assert.match(markup, /More clip controls/);
  assert.match(markup, />In</);
  assert.match(markup, />Out</);
  assert.match(markup, />Duration</);
});

void test("renders editor poster with the shared thumbnail view transition", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorPreview, {
      canvasRef: createRef<HTMLCanvasElement>(),
      playing: false,
      loadingPreview: true,
      loadingPreviewFrame: false,
      posterImageUrl: "/api/media/thumb.jpg",
      posterViewTransitionName: EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME,
      previewStatus: "Loading HLS stream...",
      previewFrameStatus: "",
      togglePlay: () => undefined,
    }),
  );

  assert.match(
    markup,
    new RegExp(`view-transition-name:${EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME}`),
  );
});

void test("renders the editor framegrab camera control", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EditorControls, {
        playing: false,
        loadingPreview: false,
        togglePlay: () => undefined,
        currentTime: 12,
        duration: 120,
        startTime: 10,
        endTime: 20,
        muted: false,
        setMuted: () => undefined,
        volume: 1,
        setVolume: () => undefined,
        handleTimelineZoomIn: () => undefined,
        handleTimelineZoomOut: () => undefined,
        canZoomIn: true,
        canZoomOut: true,
        onFramegrabClick: () => undefined,
        framegrabDisabledReason: null,
        onPreviewTimeCommit: () => undefined,
        onStartTimeCommit: () => undefined,
        onEndTimeCommit: () => undefined,
      }),
    ),
  );

  assert.match(markup, /Export current preview frame/);
  assert(
    markup.indexOf('aria-label="Zoom timeline out"') <
      markup.indexOf('aria-label="Zoom timeline in"'),
  );
  assert(
    markup.indexOf('aria-label="Zoom timeline in"') <
      markup.indexOf('aria-label="Export current preview frame"'),
  );
});

void test("reserves editor export progress label width", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EditorHeader, {
        title: "Example Movie",
        onBack: () => undefined,
        exporting: true,
        progress: 0.07,
        exportDisabledReason: null,
        onExportClick: () => undefined,
      }),
    ),
  );

  assert.match(markup, /w-40/);
  assert.match(markup, /w-\[4ch\]/);
  assert.match(markup, />7%<\/span>/);
});

void test("renders the framegrab export dialog actions", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorFramegrabDialog, {
      isOpen: true,
      title: "Example Movie",
      frameTime: 61.2,
      dimensions: {
        width: 1920,
        height: 1080,
      },
      selectedFormat: "png",
      onFormatChange: () => undefined,
      selectedQuality: "high",
      onQualityChange: () => undefined,
      fileNamePreview: "Example Movie [01m01s].png",
      processingAction: null,
      error: null,
      message: "Copied to clipboard.",
      onClose: () => undefined,
      onCopy: () => undefined,
      onDownload: () => undefined,
    }),
  );

  assert.match(markup, /Export Frame/);
  assert.match(markup, /Image Type/);
  assert.match(markup, /Quality/);
  assert.match(markup, />Time</);
  assert.match(markup, /Copy Image/);
  assert.match(markup, /Download PNG/);
  assert.doesNotMatch(markup, />Cancel</);
  assert.match(markup, /w-44/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.doesNotMatch(markup, /sr-only/);
  assert.match(markup, /Copied to clipboard\./);
  assert.match(markup, /Example Movie \[01m01s\]\.png/);
});

void test("renders GIF preset controls and immediate estimated size", () => {
  const markup = renderExportDialogMarkup({
    selectedFormat: "gif",
    selectedGifPreset: "balanced",
    gifSettings: gifExportSettingsForPreset("balanced"),
    outputSizeEstimate: { bytes: 1_572_864, basis: "gif-heuristic" },
    includeAudio: false,
    audioDisabledReason: "GIF exports are video only.",
    fileNamePreview: "Example Movie [00m10s-00m20s].gif",
    outputDimensions: { width: 853, height: 480 },
  });

  assert.match(markup, /GIF Preset/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /min-h-\[6\.5rem\]/);
  assert.match(markup, /Default quality\/size tradeoff\./);
  assert.match(markup, /Balanced GIF \/ 12 fps/);
  assert.match(markup, /Filename[\s\S]*Estimated size/);
  assert.match(markup, /~1\.5 MB/);
  assert.match(markup, /GIF exports are video only\./);
  assert.doesNotMatch(markup, /role="radiogroup"/);
  assert.doesNotMatch(markup, /role="note"/);
  assert.doesNotMatch(markup, /aria-live="polite"/);
});

void test("hides GIF-only export details for video formats", () => {
  const markup = renderExportDialogMarkup({
    selectedFormat: "mp4",
    gifSettings: gifExportSettingsForPreset("balanced"),
  });

  assert.doesNotMatch(markup, /GIF Preset/);
  assert.match(markup, /min-h-\[6\.5rem\]/);
  assert.match(markup, /Filename[\s\S]*Estimated size/);
  assert.match(markup, /~6\.7 MB/);
  assert.doesNotMatch(markup, /~1\.5 MB/);
  assert.doesNotMatch(markup, /Balanced GIF \/ 12 fps/);
  assert.doesNotMatch(markup, /invisible border-transparent/);
  assert.doesNotMatch(markup, /sm:w-36/);
  assert.doesNotMatch(markup, /Size Estimate/);
});

void test("renders unavailable summary estimate when size inputs are missing", () => {
  const markup = renderExportDialogMarkup({
    outputDimensions: null,
    outputSizeEstimate: { bytes: null, basis: "unavailable" },
  });

  assert.match(markup, /Filename[\s\S]*Estimated size/);
  assert.match(markup, /Unavailable/);
});

void test("renders framegrab capture errors without a captured canvas", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorFramegrabDialog, {
      isOpen: true,
      title: "Example Movie",
      frameTime: 61.2,
      dimensions: null,
      selectedFormat: "png",
      onFormatChange: () => undefined,
      selectedQuality: "high",
      onQualityChange: () => undefined,
      fileNamePreview: "Example Movie [01m01s].png",
      processingAction: null,
      error: "No preview frame is available yet.",
      message: null,
      onClose: () => undefined,
      onCopy: () => undefined,
      onDownload: () => undefined,
    }),
  );

  assert.match(markup, /No preview frame is available yet\./);
  assert.match(markup, /Unavailable/);
  assert.match(markup, /disabled/);
});
