import { identifyDecoderLayout } from "#/lib/audioDecoderLayout";
import {
  AudioSample,
  EncodedPacketSink,
  canEncodeAudio,
  type AudioCodec,
  type ConversionAudioOptions,
  type InputAudioTrack,
} from "mediabunny";
import {
  exportAudioCodecPriorities,
  EXPORT_AUDIO_BITRATE_BPS,
} from "#/lib/exportEncodingPolicy";
import { isAudioExportFormat, type ExportFormat } from "#/lib/exportFormats";
import { ensureAudioEncoder } from "#/lib/mediabunnyCodecs";
import { estimateAudioExportSize } from "#/lib/exportTypes";

type Speaker = "L" | "R" | "C" | "LFE" | "SL" | "SR" | "BL" | "BR" | "BC";
type Layout = readonly Speaker[];
// RFC 9639 channel assignments for FLAC.
const flacLayouts: Readonly<Record<number, Layout>> = {
  1: ["C"],
  2: ["L", "R"],
  3: ["L", "R", "C"],
  4: ["L", "R", "BL", "BR"],
  5: ["L", "R", "C", "BL", "BR"],
  6: ["L", "R", "C", "LFE", "BL", "BR"],
  7: ["L", "R", "C", "LFE", "BC", "SL", "SR"],
  8: ["L", "R", "C", "LFE", "BL", "BR", "SL", "SR"],
};
// Verified layouts accepted by MediaBunny's bundled AAC encoder. Its three-channel
// configuration is 2.1, not L/R/C. Do not infer encoder layouts from channel count.
// Seven/eight-channel AAC signaling is not verified for preservation in this release.
const aacEncoderLayouts: Readonly<Partial<Record<number, Layout>>> = {
  1: flacLayouts[1],
  2: flacLayouts[2],
  3: ["L", "R", "LFE"],
  4: ["L", "R", "C", "BC"],
  5: flacLayouts[5],
  6: flacLayouts[6],
};
// RFC 7845 mapping family 1 / Vorbis channel order.
const vorbisLayouts: Readonly<Record<number, Layout>> = {
  1: ["C"],
  2: ["L", "R"],
  3: ["L", "C", "R"],
  4: ["L", "R", "BL", "BR"],
  5: ["L", "C", "R", "BL", "BR"],
  6: ["L", "C", "R", "BL", "BR", "LFE"],
  7: ["L", "C", "R", "SL", "SR", "BC", "LFE"],
  8: ["L", "C", "R", "SL", "SR", "BL", "BR", "LFE"],
};
const aacLayouts: Readonly<Record<number, Layout>> = {
  1: ["C"],
  2: ["L", "R"],
  3: ["C", "L", "R"],
  4: ["C", "L", "R", "BC"],
  5: ["C", "L", "R", "BL", "BR"],
  6: ["C", "L", "R", "BL", "BR", "LFE"],
  7: ["C", "L", "R", "SL", "SR", "BL", "BR", "LFE"],
  // AAC channel configuration 12 identifies standard 7.1, including side and back pairs.
  12: ["C", "L", "R", "SL", "SR", "BL", "BR", "LFE"],
};

export interface AudioSourceInfo {
  codec: AudioCodec | null;
  numberOfChannels: number;
  sampleRate: number;
  layout: Layout | null;
  precision: { bits: number; kind: "integer" | "float" } | null;
}

export interface ExportAudioPlan {
  format: Exclude<ExportFormat, "gif">;
  codec: AudioCodec;
  numberOfChannels: number;
  sampleRate: number;
  bitrate: number | undefined;
  bits: 16 | 24 | 32 | null;
  sampleFormat: "s16" | "s32" | "f32";
  source: AudioSourceInfo;
  outputLayout: Layout;
  mixdown: boolean;
}

function descriptionBytes(description: AllowSharedBufferSource | undefined) {
  if (!description) {
    return new Uint8Array();
  }
  return ArrayBuffer.isView(description)
    ? new Uint8Array(
        description.buffer,
        description.byteOffset,
        description.byteLength,
      )
    : new Uint8Array(description);
}

function readBits(data: Uint8Array, start: number, length: number) {
  if (start + length > data.length * 8) {
    return null;
  }
  let value = 0;
  for (let bit = start; bit < start + length; bit++) {
    value = value * 2 + ((data[bit >> 3] >> (7 - (bit % 8))) & 1);
  }
  return value;
}

export function resolveSourceAudioLayout(
  codec: AudioCodec | null,
  channels: number,
  description: Uint8Array,
  packet?: Uint8Array,
): Layout | null {
  if (channels <= 2) {
    return flacLayouts[channels] ?? null;
  }
  let layout: Layout | undefined;
  if (codec === "flac") {
    layout = flacLayouts[channels];
  }
  if (
    codec === "opus" &&
    description.length >= 21 + channels &&
    description[18] === 1
  ) {
    layout = vorbisLayouts[channels];
  }
  if (codec === "vorbis" && description.length > 0) {
    layout = vorbisLayouts[channels];
  }
  if (codec === "aac") {
    const objectType = readBits(description, 0, 5);
    const frequencyIndex = readBits(description, 5, 4);
    // Extended object types and program config elements need a complete parser; never guess them.
    if (objectType === 2) {
      layout =
        aacLayouts[
          readBits(description, frequencyIndex === 15 ? 33 : 9, 4) ?? 0
        ];
    }
  }
  if (
    (codec === "ac3" || codec === "eac3") &&
    packet?.[0] === 11 &&
    packet[1] === 119
  ) {
    let mode: number | null;
    let lfe: number | null;
    if (codec === "ac3") {
      mode = readBits(packet, 48, 3);
      let offset = 51;
      if (mode !== null && mode !== 1 && mode & 1) {
        offset += 2;
      }
      if (mode !== null && mode & 4) {
        offset += 2;
      }
      if (mode === 2) {
        offset += 2;
      }
      lfe = readBits(packet, offset, 1);
    } else {
      mode = readBits(packet, 36, 3);
      lfe = readBits(packet, 39, 1);
    }
    const modes: Readonly<Record<number, Layout>> = {
      1: ["C"],
      2: ["L", "R"],
      3: ["L", "R", "C"],
      4: ["L", "R", "BC"],
      5: ["L", "R", "C", "BC"],
      6: ["L", "R", "SL", "SR"],
      7: ["L", "R", "C", "SL", "SR"],
    };
    const base = modes[mode ?? 0];
    if (base && lfe !== null) {
      // @mediabunny/ac3 returns FFmpeg's native AVChannelLayout ordering, with LFE after front channels.
      const front: Layout = base.filter(
        (speaker) => speaker === "L" || speaker === "R" || speaker === "C",
      );
      layout = [
        ...front,
        ...(lfe ? ["LFE" as const] : []),
        ...base.filter((speaker) => !front.includes(speaker)),
      ];
    }
  }
  return layout?.length === channels ? layout : null;
}

export function sourceAudioPrecision(
  codec: AudioCodec | null,
  description: Uint8Array,
): AudioSourceInfo["precision"] {
  const pcm = codec?.match(/^pcm-([usf])(\d+)/);
  if (pcm) {
    return { bits: Number(pcm[2]), kind: pcm[1] === "f" ? "float" : "integer" };
  }
  if (
    codec === "flac" &&
    description.length >= 42 &&
    new TextDecoder().decode(description.subarray(0, 4)) === "fLaC"
  ) {
    // STREAMINFO: 10 bytes block/frame sizes, then 20-bit rate + 3-bit channels + 5-bit precision.
    const precision = readBits(description, 8 * 8 + 10 * 8 + 23, 5);
    return precision === null ? null : { bits: precision + 1, kind: "integer" };
  }
  return null;
}

export async function inspectAudioTrack(
  track: InputAudioTrack,
  signal?: AbortSignal,
): Promise<AudioSourceInfo> {
  signal?.throwIfAborted();
  const [codec, numberOfChannels, sampleRate, config] = await Promise.all([
    track.getCodec(),
    track.getNumberOfChannels(),
    track.getSampleRate(),
    track.getDecoderConfig(),
  ]);
  const description = descriptionBytes(config?.description);
  const packet =
    numberOfChannels > 2 && (codec === "ac3" || codec === "eac3")
      ? await new EncodedPacketSink(track).getFirstPacket()
      : null;
  let layout = resolveSourceAudioLayout(
    codec,
    numberOfChannels,
    description,
    packet?.data,
  );
  if (
    layout &&
    numberOfChannels > 2 &&
    (codec === "aac" || codec === "opus" || codec === "vorbis")
  ) {
    const order = await identifyDecoderLayout(codec, numberOfChannels);
    layout = order.map((name) => {
      const speaker = layout?.find((speaker) => speaker === name);
      if (!speaker) {
        throw new Error(
          "The source layout does not match the verified decoder layout.",
        );
      }
      return speaker;
    });
  }
  signal?.throwIfAborted();
  return {
    codec,
    numberOfChannels,
    sampleRate,
    precision: sourceAudioPrecision(codec, description),
    layout,
  };
}

function nearestRate(sourceRate: number, rates: readonly number[]) {
  let best = rates[0];
  for (const rate of rates) {
    if (Math.abs(rate - sourceRate) < Math.abs(best - sourceRate)) {
      best = rate;
    }
  }
  return best;
}

export async function resolveExportAudioPlan(
  source: AudioSourceInfo,
  format: Exclude<ExportFormat, "gif">,
  mixDownToStereo: boolean,
  supports = canEncodeAudio,
  register = ensureAudioEncoder,
): Promise<ExportAudioPlan> {
  if (!source.layout) {
    throw new Error(
      "The selected audio track's channel layout is unknown. Choose a track with a standard mono, stereo, or surround layout.",
    );
  }
  const mixdown = mixDownToStereo && source.numberOfChannels > 2;
  const channels = mixdown ? 2 : source.numberOfChannels;
  if (channels > 2 && (format === "mp3" || format === "wav")) {
    throw new Error(
      `${format.toUpperCase()} supports mono or stereo export. Enable Mix down to stereo or choose another format.`,
    );
  }
  const lossless = format === "flac" || format === "wav";
  let bits: ExportAudioPlan["bits"] = null;
  if (lossless) {
    if (source.precision && source.precision.bits > 24) {
      if (format !== "wav" || source.precision.bits !== 32) {
        throw new Error(
          "This source exceeds 24-bit precision. Choose WAV to preserve 32-bit PCM.",
        );
      }
      bits = 32;
    } else {
      bits =
        !mixdown &&
        source.precision?.kind === "integer" &&
        source.precision.bits <= 16
          ? 16
          : 24;
    }
  }
  let pcmCodec: AudioCodec = bits === 16 ? "pcm-s16" : "pcm-s24";
  if (bits === 32) {
    pcmCodec = source.precision?.kind === "float" ? "pcm-f32" : "pcm-s32";
  }
  let sampleFormat: ExportAudioPlan["sampleFormat"] = "f32";
  if (bits === 16) {
    sampleFormat = "s16";
  } else if (bits === 32 && source.precision?.kind === "integer") {
    sampleFormat = "s32";
  }
  let codecs: readonly AudioCodec[];
  switch (format) {
    case "wav": {
      codecs = [pcmCodec];
      break;
    }
    case "flac": {
      codecs = ["flac"];
      break;
    }
    case "mp3": {
      codecs = ["mp3"];
      break;
    }
    case "m4a": {
      codecs = ["aac"];
      break;
    }
    case "ogg": {
      codecs = ["opus"];
      break;
    }
    case "mp4":
    case "webm":
    case "mov":
    case "mkv": {
      codecs = exportAudioCodecPriorities(format);
    }
  }
  for (const codec of codecs) {
    await register(codec);
    let sampleRate = source.sampleRate;
    if (codec === "mp3") {
      sampleRate = nearestRate(
        sampleRate,
        [8000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000],
      );
    }
    // Opus container timestamps and playback sample rate are always 48 kHz.
    if (codec === "opus") {
      sampleRate = 48_000;
    }
    if (codec === "aac") {
      sampleRate = nearestRate(
        sampleRate,
        [
          7350, 8000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100,
          48_000, 64_000, 88_200, 96_000,
        ],
      );
    }
    let bitrate: number | undefined;
    if (!lossless) {
      bitrate = (codec === "opus" ? 64_000 : 96_000) * channels;
      if (!isAudioExportFormat(format) && channels <= 2) {
        bitrate = EXPORT_AUDIO_BITRATE_BPS;
      }
      if (codec === "mp3") {
        bitrate = Math.min(
          channels === 1 ? 128_000 : 256_000,
          sampleRate < 32_000 ? 160_000 : 320_000,
        );
      }
      // The MediaBunny MP3 extension caps MPEG-2.5 output at 64 kbps.
      if (codec === "mp3" && sampleRate < 16_000) {
        bitrate = Math.min(bitrate, 64_000);
      }
      if (codec === "aac") {
        bitrate = Math.min(
          bitrate,
          Math.floor(6 * sampleRate * channels * 0.95),
        );
      }
    }
    // Bundled AAC/FLAC encoders have known input ordering. Native Opus encoding
    // has no verified surround input mapping; decoder order alone cannot prove it.
    let outputLayout: Layout | undefined;
    if (channels <= 2 || codec === "flac") {
      outputLayout = flacLayouts[channels];
    } else if (codec === "aac") {
      outputLayout = aacEncoderLayouts[channels];
    }
    // Only encode layouts whose speaker identities and ordering can be represented exactly.
    if (
      !outputLayout ||
      (!mixdown &&
        channels > 2 &&
        !outputLayout.every((speaker) => source.layout?.includes(speaker)))
    ) {
      continue;
    }
    if (
      await supports(codec, { sampleRate, numberOfChannels: channels, bitrate })
    ) {
      return {
        format,
        codec,
        numberOfChannels: channels,
        sampleRate,
        bitrate,
        bits,
        sampleFormat,
        source,
        outputLayout,
        mixdown,
      };
    }
  }
  throw new Error(
    lossless
      ? "No encoder supports this lossless sample rate and channel layout. Choose another format or enable stereo mixdown."
      : "No encoder supports the requested audio configuration. Enable stereo mixdown or choose another format.",
  );
}

export function audioBitDepthSummary(plan: ExportAudioPlan) {
  if (plan.bits === null) {
    return null;
  }
  const precision = plan.source.precision;
  let reason = "Source bit depth unknown.";
  if (plan.mixdown) {
    reason = "Preserves mixing precision.";
  } else if (precision) {
    reason =
      plan.bits === precision.bits
        ? "Matches source."
        : "Preserves source precision.";
  }
  return { bits: plan.bits, reason };
}

export function audioPlanSummary(plan: ExportAudioPlan) {
  const channels =
    { 1: "Mono", 2: "Stereo" }[plan.numberOfChannels] ??
    `${plan.numberOfChannels} channels`;
  const details = [
    plan.codec.replace("pcm-", "PCM ").toUpperCase(),
    `${plan.sampleRate / 1000} kHz`,
    channels,
  ];
  if (plan.bits) {
    details.push(`${plan.bits}-bit`);
  } else if (plan.bitrate) {
    details.push(`${plan.bitrate / 1000} kbps`);
  }
  const resampling =
    plan.sampleRate === plan.source.sampleRate
      ? ""
      : ` (resampled from ${plan.source.sampleRate / 1000} kHz)`;
  return details.join(" · ") + resampling;
}

export function assertWavSize(plan: ExportAudioPlan, duration: number) {
  if (
    plan.codec.startsWith("pcm-") &&
    (estimateAudioExportSize(plan, duration).bytes ?? 0) >=
      2 ** 32 - 1024 * 1024
  ) {
    throw new Error(
      "This WAV would exceed its 4 GiB file-size limit. Shorten the clip or choose FLAC.",
    );
  }
}

export function processExportAudio(
  sample: AudioSample,
  plan: ExportAudioPlan,
): AudioSample {
  const layout = plan.source.layout;
  if (!layout || sample.numberOfChannels !== layout.length) {
    throw new Error("The audio channel layout changed during export.");
  }
  if (plan.mixdown) {
    const weights = layout.map((speaker): readonly [number, number] => {
      switch (speaker) {
        case "L": {
          return [1, 0];
        }
        case "R": {
          return [0, 1];
        }
        case "C":
        case "BC": {
          return [Math.SQRT1_2, Math.SQRT1_2];
        }
        case "SL":
        case "BL": {
          return [Math.SQRT1_2, 0];
        }
        case "SR":
        case "BR": {
          return [0, Math.SQRT1_2];
        }
        case "LFE": {
          return [0, 0];
        }
      }
    });
    const headroom = Math.max(
      1,
      weights.reduce((sum, weight) => sum + weight[0], 0),
      weights.reduce((sum, weight) => sum + weight[1], 0),
    );
    const output = new Float32Array(sample.numberOfFrames * 2);
    const plane = new Float32Array(sample.numberOfFrames);
    for (let channel = 0; channel < layout.length; channel++) {
      sample.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
      for (let frame = 0; frame < sample.numberOfFrames; frame++) {
        output[2 * frame] += (plane[frame] * weights[channel][0]) / headroom;
        output[2 * frame + 1] +=
          (plane[frame] * weights[channel][1]) / headroom;
      }
    }
    return new AudioSample({
      data: output,
      format: "f32",
      numberOfChannels: 2,
      sampleRate: sample.sampleRate,
      timestamp: sample.timestamp,
    });
  }
  if (layout.every((speaker, index) => speaker === plan.outputLayout[index])) {
    return sample;
  }
  // Only allocate when channels need reordering. MediaBunny handles sample format conversion.
  const bytesPerSample = plan.sampleFormat === "s16" ? 2 : 4;
  const data = new Uint8Array(
    sample.numberOfFrames * layout.length * bytesPerSample,
  );
  for (let channel = 0; channel < layout.length; channel++) {
    const inputChannel = layout.indexOf(plan.outputLayout[channel]);
    if (inputChannel === -1) {
      throw new Error("Unsupported output channel mapping.");
    }
    sample.copyTo(
      data.subarray(
        channel * sample.numberOfFrames * bytesPerSample,
        (channel + 1) * sample.numberOfFrames * bytesPerSample,
      ),
      { planeIndex: inputChannel, format: `${plan.sampleFormat}-planar` },
    );
  }
  return new AudioSample({
    data,
    format: `${plan.sampleFormat}-planar`,
    numberOfChannels: layout.length,
    sampleRate: sample.sampleRate,
    timestamp: sample.timestamp,
  });
}

// Copy in the decoded sample's own format before requesting integer conversion.
// This keeps browser AudioData rounding out of lossless exports while using only
// MediaBunny's public sample API and its released PCM conversion implementation.
function prepareLosslessAudio(
  sample: AudioSample,
  plan: ExportAudioPlan,
): AudioSample {
  const planes = sample.format.endsWith("-planar")
    ? sample.numberOfChannels
    : 1;
  const planeBytes = sample.allocationSize({
    format: sample.format,
    planeIndex: 0,
  });
  const data = new Uint8Array(planeBytes * planes);
  for (let planeIndex = 0; planeIndex < planes; planeIndex++) {
    sample.copyTo(
      data.subarray(planeIndex * planeBytes, (planeIndex + 1) * planeBytes),
      {
        format: sample.format,
        planeIndex,
      },
    );
  }
  const owned = new AudioSample({
    data,
    format: sample.format,
    numberOfChannels: sample.numberOfChannels,
    sampleRate: sample.sampleRate,
    timestamp: sample.timestamp,
  });
  let processed = owned;
  let returned: AudioSample | undefined;
  try {
    processed = processExportAudio(owned, plan);
    if (processed.format.replace("-planar", "") === plan.sampleFormat) {
      returned = processed;
      return returned;
    }
    const output = new Uint8Array(
      processed.allocationSize({ format: plan.sampleFormat, planeIndex: 0 }),
    );
    processed.copyTo(output, { format: plan.sampleFormat, planeIndex: 0 });
    returned = new AudioSample({
      data: output,
      format: plan.sampleFormat,
      numberOfChannels: processed.numberOfChannels,
      sampleRate: processed.sampleRate,
      timestamp: processed.timestamp,
    });
    return returned;
  } finally {
    if (processed !== owned && processed !== returned) {
      processed.close();
    }
    if (owned !== returned) {
      owned.close();
    }
  }
}

export function audioConversionOptions(
  plan: ExportAudioPlan,
): ConversionAudioOptions {
  return {
    codec: plan.codec,
    bitrate: plan.bitrate,
    forceTranscode: true,
    sampleRate: plan.sampleRate,
    sampleFormat: plan.bits === null ? plan.sampleFormat : undefined,
    processedNumberOfChannels: plan.numberOfChannels,
    processedSampleRate: plan.sampleRate,
    process: (sample) =>
      plan.bits === null
        ? processExportAudio(sample, plan)
        : prepareLosslessAudio(sample, plan),
  };
}
