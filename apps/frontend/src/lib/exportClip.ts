import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  UrlSource,
} from "mediabunny";
import type { ConversionOptions, DiscardedTrack, InputTrack } from "mediabunny";
import { ensureMediabunnyCodecs } from "./mediabunnyCodecs";

interface ExportClipOptions {
  mediaUrl: string;
  startTime: number;
  endTime: number;
  resolution: "original" | "1080" | "720";
  onProgress: (progress: number) => void;
}

const discardReasonLabels: Record<DiscardedTrack["reason"], string> = {
  discarded_by_user: "discarded by configuration",
  max_track_count_reached: "the output track limit was reached",
  max_track_count_of_type_reached: "the output cannot contain another track of this type",
  unknown_source_codec: "the source codec is unknown",
  undecodable_source_codec: "the source codec could not be decoded",
  no_encodable_target_codec: "no compatible output codec could be encoded",
};

function describeTrack(track: InputTrack) {
  const codec = track.codec ?? track.internalCodecId ?? "unknown codec";
  const label = `${track.type} ${track.number}`;
  const name = track.name ? ` "${track.name}"` : "";

  return `${label}${name} (${codec})`;
}

function describeDiscardedTracks(discardedTracks: readonly DiscardedTrack[]) {
  if (discardedTracks.length === 0) {
    return "";
  }

  return discardedTracks
    .map(({ track, reason }) => `${describeTrack(track)}: ${discardReasonLabels[reason]}`)
    .join("; ");
}

function buildAudioDroppedError(discardedTracks: readonly DiscardedTrack[]) {
  const discardedDetails = describeDiscardedTracks(discardedTracks);
  const suffix = discardedDetails ? ` ${discardedDetails}` : " Mediabunny did not report a discarded-track reason.";

  return new Error(`Export would drop the source audio track.${suffix}`);
}

async function assertExportHasAudio(blob: Blob, sourceAudioTracks: readonly InputTrack[]) {
  const outputInput = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });

  try {
    const outputAudioTracks = await outputInput.getAudioTracks();
    if (outputAudioTracks.length === 0) {
      const sourceDetails = sourceAudioTracks.map(describeTrack).join("; ");
      throw new Error(`Export produced an MP4 without an audio track. Source audio: ${sourceDetails}.`);
    }
  } finally {
    outputInput.dispose();
  }
}

export async function exportClip({
  mediaUrl,
  startTime,
  endTime,
  resolution,
  onProgress,
}: ExportClipOptions) {
  await ensureMediabunnyCodecs();

  const input = new Input({
    source: new UrlSource(mediaUrl),
    formats: ALL_FORMATS,
  });

  try {
    const sourceAudioTracks = await input.getAudioTracks();
    const sourceHasAudio = sourceAudioTracks.length > 0;

    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat(),
      target,
    });

    const conversionOptions: ConversionOptions = {
      input,
      output,
      audio: {
        codec: "aac",
        forceTranscode: true,
        numberOfChannels: 2,
        bitrate: 160_000,
      },
      trim: {
        start: startTime,
        end: endTime,
      },
      showWarnings: false,
    };

    if (resolution !== "original") {
      conversionOptions.video = {
        height: parseInt(resolution, 10),
        fit: "contain",
      };
    }

    const conversion = await Conversion.init(conversionOptions);
    const utilizedAudioTracks = conversion.utilizedTracks.filter((track) => track.isAudioTrack());

    if (!conversion.isValid) {
      const discardedDetails = describeDiscardedTracks(conversion.discardedTracks);
      const suffix = discardedDetails ? ` ${discardedDetails}` : "";
      throw new Error(`Conversion is invalid.${suffix}`);
    }

    if (sourceHasAudio && utilizedAudioTracks.length === 0) {
      throw buildAudioDroppedError(conversion.discardedTracks);
    }

    conversion.onProgress = onProgress;

    await conversion.execute();

    if (!target.buffer) {
      throw new Error("Export did not produce a video buffer");
    }

    const blob = new Blob([target.buffer], { type: "video/mp4" });

    if (sourceHasAudio) {
      await assertExportHasAudio(blob, sourceAudioTracks);
    }

    return blob;
  } finally {
    input.dispose();
  }
}
