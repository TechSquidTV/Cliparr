import {
  BufferTarget,
  Conversion,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from "mediabunny";
import type { ConversionOptions, VideoSample } from "mediabunny";
import type { EditorMediaSource } from "@/lib/editorMedia";
import { createCliparrInputFromSource } from "@/lib/mediabunnyInput";
import { ensureMediabunnyCodecs } from "@/lib/mediabunnyCodecs";
import {
  getTrackTimelineOffsetSeconds,
  getVideoTrackDimensions,
  toSourceTimelineTime,
} from "@/lib/mediabunnyTrackAccess";
import { selectPreferredPairableAudioTrack } from "@/lib/selectPreferredAudioTrack";
import type {
  MediaExportMetadata,
  PlaybackAudioSelection,
} from "@/providers/types";
import {
  buildMetadataTags,
  describeDiscardedTracks,
  isIsobmffExportFormat,
  patchMp4MetadataBoxes,
} from "@/lib/exportMetadata";
import type { ExportFormat, ExportResolution } from "@/lib/exportTypes";
import { getActiveSubtitleCue } from "@/lib/subtitles/getActiveSubtitleCue";
import { renderSubtitleCue } from "@/lib/subtitles/renderSubtitleCue";
import { trimSubtitleCues } from "@/lib/subtitles/trimSubtitleCues";
import type { SubtitleCue, SubtitleStyleSettings } from "@/lib/subtitles/types";

export type { ExportFormat, ExportResolution } from "@/lib/exportTypes";

interface ExportClipOptions {
  mediaSource: EditorMediaSource;
  hls?: boolean;
  startTime: number;
  endTime: number;
  format: ExportFormat;
  resolution: ExportResolution;
  includeAudio: boolean;
  selectedAudioTrack?: PlaybackAudioSelection;
  metadata?: MediaExportMetadata;
  includeBurnedSubtitles?: boolean;
  subtitleCues?: readonly SubtitleCue[];
  subtitleStyleSettings?: SubtitleStyleSettings;
  onProgress: (progress: number) => void;
}

interface ExportClipRuntime {
  ensureMediabunnyCodecs: typeof ensureMediabunnyCodecs;
  createCliparrInputFromSource: typeof createCliparrInputFromSource;
  selectPreferredPairableAudioTrack: typeof selectPreferredPairableAudioTrack;
  getTrackTimelineOffsetSeconds: typeof getTrackTimelineOffsetSeconds;
  getVideoTrackDimensions: typeof getVideoTrackDimensions;
  buildMetadataTags: typeof buildMetadataTags;
  describeDiscardedTracks: typeof describeDiscardedTracks;
  patchMp4MetadataBoxes: typeof patchMp4MetadataBoxes;
  createOutputFormat: typeof createOutputFormat;
  createBufferTarget: () => BufferTarget;
  createOutput: (options: ConstructorParameters<typeof Output>[0]) => Output;
  initConversion: typeof Conversion.init;
  buildSubtitleBurnInProcessor: typeof buildSubtitleBurnInProcessor;
}

function createOutputFormat(format: ExportFormat) {
  switch (format) {
    case "mp4":
      return new Mp4OutputFormat({ fastStart: "in-memory" });
    case "webm":
      return new WebMOutputFormat();
    case "mov":
      return new MovOutputFormat({ fastStart: "in-memory" });
    case "mkv":
      return new MkvOutputFormat();
  }
}

function buildSubtitleBurnInProcessor(
  cues: readonly SubtitleCue[],
  styleSettings: SubtitleStyleSettings,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a subtitle rendering canvas.");
  }

  return (sample: VideoSample) => {
    const width = Math.max(1, sample.displayWidth);
    const height = Math.max(1, sample.displayHeight);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.clearRect(0, 0, width, height);
    sample.draw(context, 0, 0, width, height);

    const activeCue = getActiveSubtitleCue(cues, sample.timestamp);
    if (activeCue) {
      renderSubtitleCue(context, activeCue, styleSettings, width, height);
    }

    return canvas;
  };
}

export async function exportClip({
  mediaSource,
  hls,
  startTime,
  endTime,
  format,
  resolution,
  includeAudio,
  selectedAudioTrack,
  metadata,
  includeBurnedSubtitles = false,
  subtitleCues = [],
  subtitleStyleSettings,
  onProgress,
}: ExportClipOptions) {
  return exportClipWithRuntime(
    {
      mediaSource,
      hls,
      startTime,
      endTime,
      format,
      resolution,
      includeAudio,
      selectedAudioTrack,
      metadata,
      includeBurnedSubtitles,
      subtitleCues,
      subtitleStyleSettings,
      onProgress,
    },
    defaultExportClipRuntime,
  );
}

const defaultExportClipRuntime: ExportClipRuntime = {
  ensureMediabunnyCodecs,
  createCliparrInputFromSource,
  selectPreferredPairableAudioTrack,
  getTrackTimelineOffsetSeconds,
  getVideoTrackDimensions,
  buildMetadataTags,
  describeDiscardedTracks,
  patchMp4MetadataBoxes,
  createOutputFormat,
  createBufferTarget: () => new BufferTarget(),
  createOutput: (options) => new Output(options),
  initConversion: (options) => Conversion.init(options),
  buildSubtitleBurnInProcessor,
};

export async function exportClipWithRuntime(
  {
    mediaSource,
    hls,
    startTime,
    endTime,
    format,
    resolution,
    includeAudio,
    selectedAudioTrack,
    metadata,
    includeBurnedSubtitles = false,
    subtitleCues = [],
    subtitleStyleSettings,
    onProgress,
  }: ExportClipOptions,
  runtime: ExportClipRuntime,
) {
  await runtime.ensureMediabunnyCodecs();

  const input = await runtime.createCliparrInputFromSource(mediaSource, {
    hls,
  });

  try {
    const sourceVideoTrack = await input.getPrimaryVideoTrack({
      filter: async (track) => !(await track.hasOnlyKeyPackets()),
    });
    const sourceAudioTracks = await input.getAudioTracks();
    const preferredAudioTrack = await runtime.selectPreferredPairableAudioTrack(
      sourceVideoTrack,
      sourceAudioTracks,
      selectedAudioTrack,
    );
    const sourceHasAudio = sourceAudioTracks.length > 0;

    const timelineOffsetSeconds = await runtime.getTrackTimelineOffsetSeconds([
      sourceVideoTrack,
      includeAudio ? preferredAudioTrack : undefined,
    ]);
    const trimStart = toSourceTimelineTime(startTime, timelineOffsetSeconds);
    const trimEnd = toSourceTimelineTime(endTime, timelineOffsetSeconds);

    const sourceVideoDimensions = sourceVideoTrack
      ? await runtime.getVideoTrackDimensions(sourceVideoTrack)
      : null;
    const outputHeight =
      resolution === "original"
        ? sourceVideoDimensions?.height
        : parseInt(resolution, 10);
    const clippedSubtitleCues =
      includeBurnedSubtitles && subtitleCues.length > 0
        ? trimSubtitleCues(subtitleCues, startTime, endTime)
        : [];
    const shouldBurnSubtitles = clippedSubtitleCues.length > 0;

    if (includeBurnedSubtitles && !subtitleStyleSettings) {
      throw new Error("Subtitle burn-in was requested without style settings.");
    }

    if (includeBurnedSubtitles && !sourceVideoTrack) {
      throw new Error("Subtitle burn-in requires a video track.");
    }

    const outputFormat = runtime.createOutputFormat(format);
    const target = runtime.createBufferTarget();
    const metadataTags = await runtime.buildMetadataTags(
      metadata,
      startTime,
      endTime,
      outputHeight,
      format,
    );
    const output = runtime.createOutput({
      format: outputFormat,
      target,
    });

    const baseAudioOptions = {
      // Let Mediabunny choose the first encodable codec supported by the
      // target container instead of forcing AAC for every export format.
      forceTranscode: true,
      numberOfChannels: 2,
      bitrate: 160_000,
    } as const;

    const conversionOptions: ConversionOptions = {
      input,
      output,
      audio: includeAudio
        ? preferredAudioTrack
          ? (track) => ({
              ...baseAudioOptions,
              discard: track.id !== preferredAudioTrack.id,
            })
          : baseAudioOptions
        : {
            discard: true,
          },
      trim: {
        start: trimStart,
        end: trimEnd,
      },
      showWarnings: false,
    };

    if (metadataTags) {
      conversionOptions.tags = metadataTags;
    }

    if (sourceVideoTrack) {
      conversionOptions.video = (track) => ({
        discard: track.id !== sourceVideoTrack.id,
        ...(resolution !== "original"
          ? {
              height: parseInt(resolution, 10),
              fit: "contain" as const,
            }
          : {}),
        ...(shouldBurnSubtitles && subtitleStyleSettings
          ? {
              forceTranscode: true,
              process: runtime.buildSubtitleBurnInProcessor(
                clippedSubtitleCues,
                subtitleStyleSettings,
              ),
            }
          : {}),
      });
    } else if (resolution !== "original") {
      conversionOptions.video = {
        height: parseInt(resolution, 10),
        fit: "contain",
      };
    }

    const conversion = await runtime.initConversion(conversionOptions);
    const utilizedAudioTracks = conversion.utilizedTracks.filter((track) =>
      track.isAudioTrack(),
    );

    if (!conversion.isValid) {
      const discardedDetails = await runtime.describeDiscardedTracks(
        conversion.discardedTracks,
      );
      const suffix = discardedDetails ? ` ${discardedDetails}` : "";
      throw new Error(`Conversion is invalid.${suffix}`);
    }

    if (includeAudio && sourceHasAudio && utilizedAudioTracks.length === 0) {
      const discardedDetails = await runtime.describeDiscardedTracks(
        conversion.discardedTracks,
      );
      const suffix = discardedDetails
        ? ` ${discardedDetails}`
        : " Mediabunny did not report a discarded-track reason.";
      throw new Error(`Export would drop the source audio track.${suffix}`);
    }

    conversion.onProgress = onProgress;

    await conversion.execute();

    if (!target.buffer) {
      throw new Error("Export did not produce a video buffer");
    }

    if (isIsobmffExportFormat(format)) {
      runtime.patchMp4MetadataBoxes(new Uint8Array(target.buffer));
    }

    // Conversion.init already proved that at least one audio track made it into the
    // output plan; reparsing the completed file adds memory pressure for long exports.
    const blob = new Blob([target.buffer], { type: outputFormat.mimeType });

    return blob;
  } finally {
    input.dispose();
  }
}
