/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  createProviderUrlSource,
  type EditorMediaSource,
} from "@/lib/editorMedia";
import {
  buildExportSourceLabel,
  buildExportSourceMessage,
  buildExportSourceSummaryMessage,
  buildExportEstimateActualLogFields,
  buildExportEstimateLogFields,
  getEditorExportReadiness,
  getOutputDimensions,
  resolveExportSource,
} from "@/components/editor/useEditorExport";
import {
  DEFAULT_GIF_EXPORT_PRESET,
  DEFAULT_VIDEO_EXPORT_QUALITY,
  estimateExportOutputSize,
  exportQualityDescriptionFor,
  exportQualityOptions,
  gifExportPresetOptions,
  gifExportSettingsForPreset,
} from "@/lib/exportTypes";

const localFileSource = {
  kind: "file",
  role: "local-file",
  label: "Local file",
  file: new File(["video"], "movie.mp4", { type: "video/mp4" }),
  fileName: "movie.mp4",
} satisfies EditorMediaSource;

void test("resolves provider export sources by preference", () => {
  const hlsSource = createProviderUrlSource("/playback/master.m3u8", "hls");
  const directSource = createProviderUrlSource("/media/movie.mp4", "direct");

  assert.deepEqual(
    resolveExportSource({
      preference: "auto",
      hlsSource,
      directSource,
    }),
    {
      source: hlsSource,
      kind: "hls",
    },
  );

  assert.deepEqual(
    resolveExportSource({
      preference: "direct",
      hlsSource,
      directSource,
    }),
    {
      source: directSource,
      kind: "direct",
    },
  );
});

void test("resolves local file export sources", () => {
  assert.deepEqual(
    resolveExportSource({
      preference: "auto",
      directSource: localFileSource,
    }),
    {
      source: localFileSource,
      kind: "direct",
    },
  );

  assert.deepEqual(
    resolveExportSource({
      preference: "hls",
      directSource: localFileSource,
    }),
    {
      source: null,
      kind: "none",
    },
  );
});

void test("uses export fallback source when auto-selected", () => {
  const hlsSource = createProviderUrlSource("/playback/master.m3u8", "hls");

  assert.deepEqual(
    resolveExportSource({
      preference: "auto",
      hlsSource,
      directSource: localFileSource,
      exportFallbackSource: localFileSource,
    }),
    {
      source: localFileSource,
      kind: "direct",
    },
  );
});

void test("reports editor export readiness and subtitle blockers", () => {
  const hlsSource = createProviderUrlSource("/playback/master.m3u8", "hls");
  const readySource = { source: hlsSource, kind: "hls" as const };
  const textSubtitleTrack = {
    streamId: "subtitle-1",
    isText: true,
    contentUrl: "/subtitles/1.srt",
    contentFormat: "srt",
  };
  const imageSubtitleTrack = {
    streamId: "subtitle-2",
    isText: false,
    codec: "pgs",
  };
  const subtitleCues = [
    {
      startTime: 1,
      endTime: 2,
      text: "Hello",
      lines: ["Hello"],
    },
  ];

  assert.deepEqual(
    getEditorExportReadiness({
      exportSource: { source: null, kind: "none" },
      format: "mp4",
      exporting: false,
      startTime: 0,
      endTime: 10,
      subtitleEnabled: false,
      selectedSubtitleTrack: null,
      clippedSubtitleCues: [],
      subtitleLoading: false,
    }),
    {
      state: "idle",
      shouldBurnSubtitles: false,
    },
  );

  assert.deepEqual(
    getEditorExportReadiness({
      exportSource: readySource,
      format: "mp4",
      exporting: false,
      startTime: 10,
      endTime: 10,
      subtitleEnabled: false,
      selectedSubtitleTrack: null,
      clippedSubtitleCues: [],
      subtitleLoading: false,
    }),
    {
      state: "blocked",
      message: "Waiting for media duration.",
      shouldBurnSubtitles: false,
    },
  );

  assert.deepEqual(
    getEditorExportReadiness({
      exportSource: readySource,
      format: "mp4",
      exporting: false,
      startTime: 0,
      endTime: 10,
      subtitleEnabled: true,
      selectedSubtitleTrack: textSubtitleTrack,
      clippedSubtitleCues: subtitleCues,
      subtitleLoading: true,
    }),
    {
      state: "blocked",
      message: "Subtitles are still loading.",
      shouldBurnSubtitles: true,
    },
  );

  assert.deepEqual(
    getEditorExportReadiness({
      exportSource: readySource,
      format: "mp4",
      exporting: false,
      startTime: 0,
      endTime: 10,
      subtitleEnabled: true,
      selectedSubtitleTrack: imageSubtitleTrack,
      clippedSubtitleCues: subtitleCues,
      subtitleLoading: false,
    }),
    {
      state: "blocked",
      message: "This subtitle track is not supported.",
      shouldBurnSubtitles: true,
    },
  );

  assert.deepEqual(
    getEditorExportReadiness({
      exportSource: readySource,
      format: "mp4",
      exporting: false,
      startTime: 0,
      endTime: 10,
      subtitleEnabled: true,
      selectedSubtitleTrack: textSubtitleTrack,
      clippedSubtitleCues: subtitleCues,
      subtitleLoading: false,
    }),
    {
      state: "ready",
      source: hlsSource,
      sourceKind: "hls",
      shouldBurnSubtitles: true,
    },
  );
});

void test("defines GIF export presets and balanced default", () => {
  assert.equal(DEFAULT_GIF_EXPORT_PRESET, "balanced");
  assert.equal(DEFAULT_VIDEO_EXPORT_QUALITY, "sharp");
  assert.deepEqual(
    exportQualityOptions.map((option) => ({
      value: option.value,
      label: option.label,
    })),
    [
      { value: "compact", label: "Compact" },
      { value: "balanced", label: "Balanced" },
      { value: "sharp", label: "Sharp" },
    ],
  );
  assert.equal(
    exportQualityDescriptionFor("mp4", "sharp"),
    "Preserves source video when possible.",
  );
  assert.equal(
    exportQualityDescriptionFor("gif", "balanced"),
    "Default GIF quality/size tradeoff.",
  );
  assert.deepEqual(
    gifExportPresetOptions.map((option) => ({
      value: option.value,
      maxHeight: option.settings.maxHeight,
      frameRate: option.settings.frameRate,
      maxColors: option.settings.maxColors,
      paletteMode: option.settings.paletteMode,
      paletteFormat: option.settings.paletteFormat,
      ditherMode: option.settings.ditherMode,
      temporalStrength: option.settings.temporalDither?.strength,
    })),
    [
      {
        value: "compact",
        maxHeight: 360,
        frameRate: 10,
        maxColors: 64,
        paletteMode: "global",
        paletteFormat: "rgb444",
        ditherMode: "none",
        temporalStrength: undefined,
      },
      {
        value: "balanced",
        maxHeight: 480,
        frameRate: 12,
        maxColors: 128,
        paletteMode: "per-frame",
        paletteFormat: "rgb565",
        ditherMode: "spatial-temporal",
        temporalStrength: 0.45,
      },
      {
        value: "sharp",
        maxHeight: 720,
        frameRate: 18,
        maxColors: 128,
        paletteMode: "per-frame",
        paletteFormat: "rgb565",
        ditherMode: "spatial-temporal",
        temporalStrength: 0.45,
      },
    ],
  );
  assert.deepEqual(gifExportSettingsForPreset(DEFAULT_GIF_EXPORT_PRESET), {
    preset: "balanced",
    maxHeight: 480,
    frameRate: 12,
    maxColors: 128,
    paletteMode: "per-frame",
    paletteFormat: "rgb565",
    ditherMode: "spatial-temporal",
    temporalDither: {
      strength: 0.45,
      decay: 0.6,
      maxError: 48,
      changeDetection: {
        pixelThreshold: 24,
      },
    },
  });

  const mutatedSettings = gifExportSettingsForPreset("balanced");
  if (typeof mutatedSettings.temporalDither?.changeDetection === "object") {
    mutatedSettings.temporalDither.changeDetection.pixelThreshold = 1;
  }
  assert.deepEqual(
    gifExportSettingsForPreset("balanced").temporalDither,
    gifExportSettingsForPreset(DEFAULT_GIF_EXPORT_PRESET).temporalDither,
  );
});

void test("estimates export output sizes before export", () => {
  const outputDimensions = { width: 1280, height: 720 };
  const mp4Estimate = estimateExportOutputSize({
    format: "mp4",
    durationSeconds: 10,
    outputDimensions,
    includeAudio: true,
    resolution: "720",
  });
  const webmEstimate = estimateExportOutputSize({
    format: "webm",
    durationSeconds: 10,
    outputDimensions,
    includeAudio: true,
    resolution: "720",
  });
  const movEstimate = estimateExportOutputSize({
    format: "mov",
    durationSeconds: 10,
    outputDimensions,
    includeAudio: true,
    resolution: "720",
  });
  const mkvEstimate = estimateExportOutputSize({
    format: "mkv",
    durationSeconds: 10,
    outputDimensions,
    includeAudio: true,
    resolution: "720",
  });

  assert.equal(mp4Estimate.basis, "codec-heuristic");
  assert.equal(webmEstimate.basis, "codec-heuristic");
  assert.equal(movEstimate.basis, "codec-heuristic");
  assert.equal(mkvEstimate.basis, "codec-heuristic");
  assert.equal(mp4Estimate.bytes, 4_583_500);
  assert.equal(webmEstimate.bytes, 3_038_500);
  assert.equal(movEstimate.bytes, 5_227_250);
  assert.equal(mkvEstimate.bytes, 3_424_750);
  assert(
    typeof webmEstimate.bytes === "number" &&
      typeof mp4Estimate.bytes === "number" &&
      webmEstimate.bytes < mp4Estimate.bytes,
  );
});

void test("includes audio bitrate in heuristic video estimates", () => {
  const withAudio = estimateExportOutputSize({
    format: "mp4",
    durationSeconds: 10,
    outputDimensions: { width: 1280, height: 720 },
    includeAudio: true,
    resolution: "720",
  });
  const withoutAudio = estimateExportOutputSize({
    format: "mp4",
    durationSeconds: 10,
    outputDimensions: { width: 1280, height: 720 },
    includeAudio: false,
    resolution: "720",
  });

  assert.equal(withAudio.bytes, 4_583_500);
  assert.equal(withoutAudio.bytes, 4_377_500);
});

void test("decreases video estimates as quality presets get smaller", () => {
  const outputDimensions = { width: 1280, height: 720 };
  const sharpEstimate = estimateExportOutputSize({
    format: "mp4",
    durationSeconds: 10,
    outputDimensions,
    includeAudio: true,
    resolution: "720",
    videoQuality: "sharp",
  });
  const balancedEstimate = estimateExportOutputSize({
    format: "mp4",
    durationSeconds: 10,
    outputDimensions,
    includeAudio: true,
    resolution: "720",
    videoQuality: "balanced",
  });
  const compactEstimate = estimateExportOutputSize({
    format: "mp4",
    durationSeconds: 10,
    outputDimensions,
    includeAudio: true,
    resolution: "720",
    videoQuality: "compact",
  });

  assert.equal(sharpEstimate.bytes, 4_583_500);
  assert.equal(balancedEstimate.bytes, 2_394_750);
  assert.equal(compactEstimate.bytes, 1_519_250);
  assert(
    typeof sharpEstimate.bytes === "number" &&
      typeof balancedEstimate.bytes === "number" &&
      typeof compactEstimate.bytes === "number" &&
      compactEstimate.bytes < balancedEstimate.bytes &&
      balancedEstimate.bytes < sharpEstimate.bytes,
  );
});

void test("estimates GIF presets in increasing size order", () => {
  const compactEstimate = estimateExportOutputSize({
    format: "gif",
    durationSeconds: 10,
    outputDimensions: { width: 640, height: 360 },
    includeAudio: false,
    resolution: "720",
    gifSettings: gifExportSettingsForPreset("compact"),
  });
  const balancedEstimate = estimateExportOutputSize({
    format: "gif",
    durationSeconds: 10,
    outputDimensions: { width: 853, height: 480 },
    includeAudio: false,
    resolution: "720",
    gifSettings: gifExportSettingsForPreset("balanced"),
  });
  const sharpEstimate = estimateExportOutputSize({
    format: "gif",
    durationSeconds: 10,
    outputDimensions: { width: 1280, height: 720 },
    includeAudio: false,
    resolution: "720",
    gifSettings: gifExportSettingsForPreset("sharp"),
  });

  assert.equal(compactEstimate.basis, "gif-heuristic");
  assert.equal(balancedEstimate.basis, "gif-heuristic");
  assert.equal(sharpEstimate.basis, "gif-heuristic");
  assert(
    typeof compactEstimate.bytes === "number" &&
      typeof balancedEstimate.bytes === "number" &&
      typeof sharpEstimate.bytes === "number" &&
      compactEstimate.bytes < balancedEstimate.bytes &&
      balancedEstimate.bytes < sharpEstimate.bytes,
  );
});

void test("calibrates estimates against observed browser export samples", () => {
  assert.equal(
    estimateExportOutputSize({
      format: "gif",
      durationSeconds: 5,
      outputDimensions: { width: 606, height: 320 },
      includeAudio: false,
      resolution: "original",
      gifSettings: gifExportSettingsForPreset("balanced"),
    }).bytes,
    5_604_896,
  );
  assert.equal(
    estimateExportOutputSize({
      format: "gif",
      durationSeconds: 10,
      outputDimensions: { width: 645, height: 360 },
      includeAudio: false,
      resolution: "original",
      gifSettings: gifExportSettingsForPreset("compact"),
    }).bytes,
    5_244_500,
  );
  assert.equal(
    estimateExportOutputSize({
      format: "mp4",
      durationSeconds: 10,
      outputDimensions: { width: 1920, height: 1072 },
      includeAudio: true,
      resolution: "original",
    }).bytes,
    7_029_750,
  );
  assert.equal(
    estimateExportOutputSize({
      format: "webm",
      durationSeconds: 10,
      outputDimensions: { width: 1920, height: 1072 },
      includeAudio: true,
      resolution: "original",
    }).bytes,
    4_519_125,
  );
});

void test("uses source proportional estimate only for original non-GIF passthrough-like exports", () => {
  const sourceEstimate = estimateExportOutputSize({
    format: "mp4",
    durationSeconds: 10,
    outputDimensions: { width: 1920, height: 1080 },
    includeAudio: true,
    resolution: "original",
    sourceSizeBytes: 120_000_000,
    sourceDurationSeconds: 120,
    includeBurnedSubtitles: false,
  });
  const subtitleEstimate = estimateExportOutputSize({
    format: "mp4",
    durationSeconds: 10,
    outputDimensions: { width: 1920, height: 1080 },
    includeAudio: true,
    resolution: "original",
    sourceSizeBytes: 120_000_000,
    sourceDurationSeconds: 120,
    includeBurnedSubtitles: true,
  });
  const scaledEstimate = estimateExportOutputSize({
    format: "mp4",
    durationSeconds: 10,
    outputDimensions: { width: 1280, height: 720 },
    includeAudio: true,
    resolution: "720",
    sourceSizeBytes: 120_000_000,
    sourceDurationSeconds: 120,
    includeBurnedSubtitles: false,
  });
  const balancedEstimate = estimateExportOutputSize({
    format: "mp4",
    durationSeconds: 10,
    outputDimensions: { width: 1920, height: 1080 },
    includeAudio: true,
    resolution: "original",
    sourceSizeBytes: 120_000_000,
    sourceDurationSeconds: 120,
    includeBurnedSubtitles: false,
    videoQuality: "balanced",
  });

  assert.deepEqual(sourceEstimate, {
    bytes: 10_000_000,
    basis: "source-proportional",
  });
  assert.equal(subtitleEstimate.basis, "codec-heuristic");
  assert.equal(scaledEstimate.basis, "codec-heuristic");
  assert.deepEqual(balancedEstimate, {
    bytes: 3_617_875,
    basis: "codec-heuristic",
  });
});

void test("uses HLS manifest bitrate when available for provider HLS estimates", () => {
  assert.deepEqual(
    estimateExportOutputSize({
      format: "mp4",
      durationSeconds: 10,
      outputDimensions: { width: 1920, height: 1072 },
      includeAudio: true,
      resolution: "original",
      hlsManifestBitrateKbps: 5_400,
      hlsManifestBitrateBasis: "average-bandwidth",
    }),
    {
      bytes: 6_952_500,
      basis: "hls-manifest",
    },
  );
});

void test("removes audio bitrate from HLS manifest estimates for video-only exports", () => {
  assert.deepEqual(
    estimateExportOutputSize({
      format: "mp4",
      durationSeconds: 10,
      outputDimensions: { width: 1920, height: 1072 },
      includeAudio: false,
      resolution: "original",
      hlsManifestBitrateKbps: 5_400,
      hlsManifestBitrateBasis: "average-bandwidth",
      audioBitrateKbps: 160,
    }),
    {
      bytes: 6_746_500,
      basis: "hls-manifest",
    },
  );
});

void test("uses codec heuristics for forced video quality even with HLS metadata", () => {
  assert.deepEqual(
    estimateExportOutputSize({
      format: "mp4",
      durationSeconds: 10,
      outputDimensions: { width: 1920, height: 1072 },
      includeAudio: true,
      resolution: "original",
      hlsManifestBitrateKbps: 5_400,
      hlsManifestBitrateBasis: "average-bandwidth",
      videoQuality: "balanced",
    }),
    {
      bytes: 3_617_875,
      basis: "codec-heuristic",
    },
  );
});

void test("caps peak HLS bandwidth estimates at the output codec heuristic", () => {
  assert.deepEqual(
    estimateExportOutputSize({
      format: "mp4",
      durationSeconds: 10,
      outputDimensions: { width: 1920, height: 1072 },
      includeAudio: true,
      resolution: "original",
      hlsManifestBitrateKbps: 11_000,
      hlsManifestBitrateBasis: "bandwidth",
    }),
    {
      bytes: 7_029_750,
      basis: "hls-manifest-capped",
    },
  );
});

void test("uses provider source bitrate metadata for original direct estimates", () => {
  assert.deepEqual(
    estimateExportOutputSize({
      format: "mp4",
      durationSeconds: 10,
      outputDimensions: { width: 1920, height: 1080 },
      includeAudio: true,
      resolution: "original",
      sourceBitrateKbps: 3_000,
      videoBitrateKbps: 2_600,
      audioBitrateKbps: 160,
    }),
    {
      bytes: 3_862_500,
      basis: "source-bitrate",
    },
  );

  assert.deepEqual(
    estimateExportOutputSize({
      format: "mp4",
      durationSeconds: 10,
      outputDimensions: { width: 1920, height: 1080 },
      includeAudio: true,
      resolution: "original",
      videoBitrateKbps: 2_600,
      audioBitrateKbps: 160,
    }),
    {
      bytes: 3_553_500,
      basis: "source-bitrate",
    },
  );
});

void test("builds export estimate log fields without media URLs", () => {
  assert.deepEqual(
    buildExportEstimateLogFields({
      estimate: {
        bytes: 7_029_750,
        basis: "hls-manifest-capped",
      },
      hlsEstimateMetadata: {
        bitrateKbps: 11_000,
        bitrateBasis: "bandwidth",
        width: 1920,
        height: 1080,
        frameRate: 23.976,
        variantCount: 3,
      },
      sourceSizeBytes: null,
      sourceDurationSeconds: 2624,
      sourceBitrateKbps: 10_840,
      videoBitrateKbps: 10_680,
      audioBitrateKbps: 160,
    }),
    {
      "export.estimate.bytes": 7_029_750,
      "export.estimate.basis": "hls-manifest-capped",
      "export.estimate.hls.bitrate_kbps": 11_000,
      "export.estimate.hls.bitrate_basis": "bandwidth",
      "export.estimate.hls.variant.width": 1920,
      "export.estimate.hls.variant.height": 1080,
      "export.estimate.hls.variant.frame_rate": 23.976,
      "export.estimate.hls.variant.count": 3,
      "export.estimate.source.duration_seconds": 2624,
      "export.estimate.source.bitrate_kbps": 10_840,
      "export.estimate.source.video_bitrate_kbps": 10_680,
      "export.estimate.source.audio_bitrate_kbps": 160,
    },
  );

  assert.deepEqual(
    buildExportEstimateActualLogFields(
      {
        bytes: 7_029_750,
        basis: "hls-manifest-capped",
      },
      5_833_648,
    ),
    {
      "export.estimate.actual.delta_bytes": -1_196_102,
      "export.estimate.actual.ratio": 0.83,
    },
  );
});

void test("reports unavailable size estimates without duration or dimensions", () => {
  assert.deepEqual(
    estimateExportOutputSize({
      format: "mp4",
      durationSeconds: 0,
      outputDimensions: { width: 1280, height: 720 },
      includeAudio: true,
      resolution: "720",
    }),
    { bytes: null, basis: "unavailable" },
  );
  assert.deepEqual(
    estimateExportOutputSize({
      format: "mp4",
      durationSeconds: 10,
      outputDimensions: null,
      includeAudio: true,
      resolution: "720",
    }),
    { bytes: null, basis: "unavailable" },
  );
});

void test("builds export dimensions and source messaging", () => {
  const hlsSource = createProviderUrlSource("/playback/master.m3u8", "hls");
  const directSource = createProviderUrlSource("/media/movie.mp4", "direct");
  const directUrlSource = {
    kind: "url",
    role: "direct-url",
    label: "URL",
    url: "/api/media/local-url/handle",
  } satisfies EditorMediaSource;

  assert.deepEqual(getOutputDimensions({ width: 1920, height: 1080 }, "720"), {
    width: 1280,
    height: 720,
  });
  assert.deepEqual(
    getOutputDimensions({ width: 1920, height: 1080 }, "1080", "gif"),
    {
      width: 853,
      height: 480,
    },
  );
  assert.deepEqual(
    getOutputDimensions(
      { width: 1920, height: 1080 },
      "1080",
      "gif",
      gifExportSettingsForPreset("compact"),
    ),
    {
      width: 640,
      height: 360,
    },
  );
  assert.deepEqual(
    getOutputDimensions(
      { width: 1920, height: 1080 },
      "original",
      "gif",
      gifExportSettingsForPreset("sharp"),
    ),
    {
      width: 1280,
      height: 720,
    },
  );
  assert.deepEqual(
    getOutputDimensions({ width: 1920, height: 1080 }, "original"),
    {
      width: 1920,
      height: 1080,
    },
  );
  assert.equal(getOutputDimensions({ width: 0, height: 1080 }, "720"), null);

  assert.deepEqual(
    getEditorExportReadiness({
      exportSource: { source: hlsSource, kind: "hls" },
      format: "gif",
      exporting: false,
      startTime: 0,
      endTime: 16,
      subtitleEnabled: false,
      selectedSubtitleTrack: null,
      clippedSubtitleCues: [],
      subtitleLoading: false,
    }),
    {
      state: "blocked",
      message:
        "GIF exports are limited to 15 seconds. Trim the clip or choose WebM.",
      shouldBurnSubtitles: false,
    },
  );

  assert.equal(
    buildExportSourceLabel({
      preference: "auto",
      resolvedSourceKind: "direct",
      resolvedSource: directSource,
      exportFallbackSource: directSource,
    }),
    "Auto: Direct/original fallback",
  );

  assert.equal(
    buildExportSourceLabel({
      preference: "hls",
      resolvedSourceKind: "none",
      resolvedSource: null,
    }),
    "Unavailable",
  );

  assert.equal(
    buildExportSourceMessage({
      preference: "auto",
      resolvedSourceKind: "direct",
      resolvedSource: directSource,
      hlsSource,
      directSource,
      hlsFallbackInfo: {
        category: "shared-export-blocking",
        message: "browser cannot read the stream",
      },
    }),
    "Export switched to direct media: browser cannot read the stream",
  );

  assert.equal(
    buildExportSourceMessage({
      preference: "auto",
      resolvedSourceKind: "hls",
      resolvedSource: hlsSource,
      hlsSource,
      directSource,
      hlsFallbackInfo: {
        category: "shared-export-blocking",
        message: "browser cannot read the stream",
      },
    }),
    "Export cannot use this HLS stream: browser cannot read the stream",
  );

  assert.equal(
    buildExportSourceMessage({
      preference: "auto",
      resolvedSourceKind: "direct",
      resolvedSource: directUrlSource,
      hlsFallbackInfo: null,
    }),
    "Export reads this media URL through Cliparr.",
  );

  assert.equal(
    buildExportSourceSummaryMessage({
      preference: "direct",
      resolvedSourceKind: "direct",
      resolvedSource: directSource,
      hlsSource,
    }),
    "Using direct media.",
  );
});
