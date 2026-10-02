export type ExportOutputType = "video" | "audio" | "gif";

export type ExportMode = "video-audio" | "video-only" | "audio-only";

export const exportFormats = [
  {
    value: "mp4",
    label: "MP4",
    extension: ".mp4",
    group: "Video",
    description: "Best for sharing and uploads.",
  },
  {
    value: "webm",
    label: "WEBM",
    extension: ".webm",
    group: "Video",
    description: "Modern animated web playback.",
  },
  {
    value: "gif",
    label: "GIF",
    extension: ".gif",
    group: "Image",
    description: "Animated image export for short clips.",
  },
  {
    value: "mov",
    label: "MOV",
    extension: ".mov",
    group: "Video",
    description: "Good for editing workflows.",
  },
  {
    value: "mkv",
    label: "MKV",
    extension: ".mkv",
    group: "Video",
    description: "Flexible container support.",
  },
  {
    value: "mp3",
    label: "MP3",
    extension: ".mp3",
    group: "Lossy",
    description: "Widely compatible audio for sharing.",
  },
  {
    value: "m4a",
    label: "M4A / AAC",
    extension: ".m4a",
    group: "Lossy",
    description: "Efficient audio for players and editing.",
  },
  {
    value: "ogg",
    label: "Ogg / Opus",
    extension: ".ogg",
    group: "Lossy",
    description: "Compact, high-quality audio.",
  },
  {
    value: "flac",
    label: "FLAC",
    extension: ".flac",
    group: "Lossless",
    description: "Compressed lossless audio.",
  },
  {
    value: "wav",
    label: "WAV",
    extension: ".wav",
    group: "Lossless",
    description: "Uncompressed audio for editing.",
  },
] as const satisfies readonly {
  value: string;
  label: string;
  extension: `.${string}`;
  group: "Video" | "Image" | "Lossy" | "Lossless";
  description: string;
}[];

type ExportFormatEntry = (typeof exportFormats)[number];
export type ExportFormat = ExportFormatEntry["value"];
export type VideoExportFormat = Extract<
  ExportFormatEntry,
  { group: "Video" }
>["value"];
export type AudioExportFormat = Extract<
  ExportFormatEntry,
  { group: "Lossy" | "Lossless" }
>["value"];

export function exportFormatFor(format: ExportFormat) {
  const entry = exportFormats.find((entry) => entry.value === format);
  if (!entry) {
    throw new Error(`Unsupported export format: ${format}`);
  }
  return entry;
}

export function isAudioExportFormat(
  format: ExportFormat,
): format is AudioExportFormat {
  const { group } = exportFormatFor(format);
  return group === "Lossy" || group === "Lossless";
}

export function exportIncludesAudio(mode: ExportMode, format: ExportFormat) {
  return mode !== "video-only" && format !== "gif";
}
