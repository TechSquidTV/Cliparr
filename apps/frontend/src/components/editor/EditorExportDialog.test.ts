import assert from "node:assert/strict";
import test from "node:test";

import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorExportDialog } from "#/components/editor/EditorExportDialog";
import { TooltipProvider } from "#/components/ui/tooltip";
import { resolveExportAudioPlan } from "#/lib/export/exportAudio";
import { gifExportSettingsForPreset } from "#/lib/export/exportTypes";

function renderExportDialogMarkup(
  overrides: Partial<ComponentProps<typeof EditorExportDialog>> = {},
) {
  const props = {
    isOpen: true,
    title: "Example Movie",
    clipStart: 10,
    clipEnd: 20,
    selectedFormat: "mp4",
    onFormatChange: () => {},
    selectedQuality: "sharp",
    onQualityChange: () => {},
    gifSettings: null,
    outputSizeEstimate: { bytes: 7_029_750, basis: "transcode-plan" },
    selectedResolution: "original",
    onResolutionChange: () => {},
    selectedSourcePreference: "auto",
    onSourcePreferenceChange: () => {},
    mode: "video-audio",
    mixDownToStereo: true,
    onMixDownToStereoChange: () => {},
    audioStatus: "Stereo",
    audioPlan: null,
    audioBitDepth: null,
    onOutputTypeChange: () => {},
    onVideoMutedChange: () => {},
    audioDisabledReason: null,
    exporting: false,
    progress: 0,
    exportPhase: "preparing",
    exportNotice: null,
    onCancelExport: () => {},
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
    onEditingTemplateKindChange: () => {},
    fileNameTemplates: {
      movie: "{title} [{start}-{end}]",
      episode: "{series} - {episodeTitle} [{start}-{end}]",
    },
    onFileNameTemplateChange: () => {},
    onResetFileNameTemplate: () => {},
    onClose: () => {},
    onExport: () => {},
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

void test("renders GIF export quality controls and immediate estimated size", () => {
  const markup = renderExportDialogMarkup({
    selectedFormat: "gif",
    selectedQuality: "balanced",
    gifSettings: gifExportSettingsForPreset("balanced"),
    outputSizeEstimate: { bytes: 1_572_864, basis: "gif-profile" },
    mode: "video-only",
    audioDisabledReason: "GIF exports are video only.",
    fileNamePreview: "Example Movie [00m10s-00m20s].gif",
    outputDimensions: { width: 853, height: 480 },
  });

  assert.match(markup, /Quality/);
  assert.match(markup, /aria-label="Export quality"/);
  assert.doesNotMatch(markup, /aria-pressed=/);
  assert.doesNotMatch(markup, /GIF Preset/);
  assert.doesNotMatch(markup, /min-h-\[6\.5rem]/);
  assert.match(markup, /Default GIF quality\/size tradeoff\./);
  assert.match(markup, /aria-label="GIF dimensions"/);
  assert.match(markup, /853 × 480/);
  assert.match(markup, /Up to 480p\. Smaller sources unchanged\./);
  assert.doesNotMatch(markup, /Select resolution/);
  assert.match(markup, /Balanced GIF \/ 12 fps/);
  assert.doesNotMatch(markup, /<dt[^>]*>Estimated size<\/dt>/);
  assert.match(markup, /Estimated size[\S\s]*~1\.5 MB[\S\s]*Export GIF/);
  assert.match(markup, /~1\.5 MB/);
  assert.doesNotMatch(markup, /GIF has no audio/);
  assert.doesNotMatch(markup, /Select format/);
  assert.doesNotMatch(markup, /<dt[^>]*>Audio<\/dt>/);
  assert.match(
    markup,
    /<label[^>]*invisible[^>]*aria-hidden="true"[^>]*inert=""/,
  );
  assert.doesNotMatch(markup, /role="radiogroup"/);
  assert.doesNotMatch(markup, /grid-cols-3/);
  assert.doesNotMatch(markup, /role="note"/);
  assert.doesNotMatch(markup, /aria-live="polite"/);
});

void test("renders universal quality details for video formats", () => {
  const markup = renderExportDialogMarkup({
    selectedFormat: "mp4",
    selectedQuality: "sharp",
    gifSettings: gifExportSettingsForPreset("balanced"),
  });

  assert.match(markup, /Quality/);
  assert.doesNotMatch(markup, /Efficient/);
  assert.match(markup, /Preserves source video when possible\./);
  assert.match(markup, /Sharp quality/);
  assert.match(markup, /data-slot="select-value">MP4 \.mp4<\/span>/);
  assert.doesNotMatch(markup, /GIF Preset/);
  assert.doesNotMatch(markup, /min-h-\[6\.5rem]/);
  assert.doesNotMatch(markup, /<dt[^>]*>Estimated size<\/dt>/);
  assert.match(markup, /Estimated size[\S\s]*~6\.7 MB[\S\s]*Export MP4/);
  assert.match(markup, /~6\.7 MB/);
  assert.doesNotMatch(markup, /~1\.5 MB/);
  assert.doesNotMatch(markup, /Balanced GIF \/ 12 fps/);
  assert.doesNotMatch(markup, /invisible border-transparent/);
  assert.doesNotMatch(markup, /sm:w-36/);
  assert.doesNotMatch(markup, /Size Estimate/);
});

void test("renders unavailable footer estimate when size inputs are missing", () => {
  const markup = renderExportDialogMarkup({
    outputDimensions: null,
    outputSizeEstimate: { bytes: null, basis: "unavailable" },
  });

  assert.doesNotMatch(markup, /<dt[^>]*>Estimated size<\/dt>/);
  assert.match(markup, /Estimated size[\S\s]*Unavailable[\S\s]*Export MP4/);
  assert.match(markup, /Unavailable/);
});

void test("audio-only dialog hides video and subtitle controls while showing audio characteristics", () => {
  const markup = renderExportDialogMarkup({
    mode: "audio-only",
    selectedFormat: "flac",
    audioStatus: "Ready",
    audioPlan: {
      format: "flac",
      codec: "flac",
      sampleRate: 48_000,
      numberOfChannels: 2,
      bitrate: undefined,
      bits: 24,
      sampleFormat: "f32",
      mixdown: false,
      outputLayout: ["L", "R"],
      source: {
        codec: "aac",
        sampleRate: 48_000,
        numberOfChannels: 2,
        layout: ["L", "R"],
        precision: null,
      },
    },
    outputDimensions: null,
    outputSizeEstimate: { bytes: null, basis: "variable" },
  });
  assert.match(markup, /Mix down to stereo/);
  assert.match(markup, /Channels<\/dt>[\s\S]*Stereo<\/dd>/);
  assert.match(markup, /Sample rate<\/dt>[\s\S]*48 kHz<\/dd>/);
  assert.match(markup, /Bit depth<\/dt>[\s\S]*24-bit<\/dd>/);
  assert.doesNotMatch(markup, /Codec<\/dt>/);
  assert.match(markup, /Variable \(lossless compression\)/);
  assert.doesNotMatch(
    markup,
    /Export quality|>Resolution<|>Subtitles<|Unknown size/,
  );
});

void test("renders resolved audio details without repeating codecs or hiding resampling", async () => {
  for (const format of ["ogg", "wav"] as const) {
    const audioPlan = await resolveExportAudioPlan(
      {
        codec: "pcm-f32",
        sampleRate: 96_000,
        numberOfChannels: 1,
        layout: ["C"],
        precision: { bits: 32, kind: "float" },
      },
      format,
      false,
      async () => true,
      async () => {},
    );
    const markup = renderExportDialogMarkup({
      mode: "audio-only",
      selectedFormat: format,
      audioPlan,
      audioStatus: "Ready",
      outputDimensions: null,
    });
    assert.match(markup, /Channels<\/dt>[\s\S]*Mono<\/dd>/);
    if (format === "ogg") {
      assert.match(markup, /Bitrate<\/dt>[\s\S]*64 kbps<\/dd>/);
      assert.match(markup, /Resampled from 96 kHz\./);
      assert.doesNotMatch(markup, /Codec<\/dt>|Bit depth<\/dt>/);
    } else {
      assert.match(markup, /Codec<\/dt>[\s\S]*PCM \(float\)<\/dd>/);
      assert.match(markup, /Bit depth<\/dt>[\s\S]*32-bit<\/dd>/);
      assert.doesNotMatch(markup, /Bitrate<\/dt>|Resampled from/);
    }
  }
});
