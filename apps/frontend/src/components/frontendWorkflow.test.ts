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
import { EditorPreview } from "@/components/editor/EditorPreview";
import { LocalVideoOpenDialog } from "@/components/local-media/LocalVideoOpenDialog";
import { MobilePwaInstallNudgeCard } from "@/components/MobilePwaInstallNudge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { gifExportSettingsForPreset } from "@/lib/exportTypes";
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
    projectedOutputBytes: null,
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

void test("renders GIF preset controls and live projected size", () => {
  const markup = renderExportDialogMarkup({
    selectedFormat: "gif",
    selectedGifPreset: "balanced",
    gifSettings: gifExportSettingsForPreset("balanced"),
    outputSizeEstimate: { bytes: 1_025_984, basis: "gif-heuristic" },
    projectedOutputBytes: 1_572_864,
    includeAudio: false,
    audioDisabledReason: "GIF exports are video only.",
    fileNamePreview: "Example Movie [00m10s-00m20s].gif",
    outputDimensions: { width: 853, height: 480 },
  });

  assert.match(markup, /GIF Preset/);
  assert.match(markup, /480p max, 12 fps, 128 colors, stable palette\./);
  assert.match(markup, /12 fps \/ 128 colors \/ stable palette/);
  assert.match(markup, /Filename[\s\S]*Estimated size/);
  assert.match(markup, /~1\.5 MB/);
  assert.match(markup, /GIF exports are video only\./);
  assert.match(markup, /role="note"/);
  assert.match(
    markup,
    /GIF is a legacy animated image format\. Use WebM when your destination supports it; choose GIF only for platforms that require it\./,
  );
});

void test("hides GIF-only export details for video formats", () => {
  const markup = renderExportDialogMarkup({
    selectedFormat: "mp4",
    gifSettings: gifExportSettingsForPreset("balanced"),
    projectedOutputBytes: 1_572_864,
  });

  assert.doesNotMatch(markup, /GIF Preset/);
  assert.match(markup, /Filename[\s\S]*Estimated size/);
  assert.match(markup, /~6\.7 MB/);
  assert.doesNotMatch(markup, /~1\.5 MB/);
  assert.doesNotMatch(markup, /12 fps \/ 128 colors \/ stable palette/);
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
