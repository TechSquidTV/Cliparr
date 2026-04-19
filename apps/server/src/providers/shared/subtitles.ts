import { stringValue } from "./utils.js";

const TEXT_SUBTITLE_CODECS = new Set([
  "ass",
  "dfxp",
  "mov_text",
  "smi",
  "srt",
  "ssa",
  "subrip",
  "text",
  "ttml",
  "tx3g",
  "vtt",
  "webvtt",
]);

const SUBTITLE_CODEC_EXTENSIONS: Record<string, string> = {
  ass: "ass",
  dfxp: "dfxp",
  mov_text: "txt",
  pgs: "sup",
  smi: "smi",
  srt: "srt",
  ssa: "ssa",
  subrip: "srt",
  text: "txt",
  ttml: "ttml",
  tx3g: "txt",
  vobsub: "sub",
  vtt: "vtt",
  webvtt: "vtt",
};

export function booleanFlag(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true") {
      return true;
    }
    if (normalized === "0" || normalized === "false") {
      return false;
    }
  }

  return undefined;
}

export function normalizeSubtitleCodec(codec: unknown) {
  return stringValue(codec)?.toLowerCase();
}

export function isTextSubtitleCodec(codec: unknown) {
  const normalized = normalizeSubtitleCodec(codec);
  return normalized ? TEXT_SUBTITLE_CODECS.has(normalized) : false;
}

function extensionFromPath(path: string | undefined) {
  const pathname = path?.split("?")[0];
  if (!pathname) {
    return undefined;
  }

  const match = pathname.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase();
}

export function subtitleFileExtension(codec: unknown, path?: string) {
  const normalized = normalizeSubtitleCodec(codec);
  if (normalized) {
    const mapped = SUBTITLE_CODEC_EXTENSIONS[normalized];
    if (mapped) {
      return mapped;
    }
  }

  return extensionFromPath(path);
}

export function subtitleContentFormat(codec: unknown) {
  return isTextSubtitleCodec(codec) ? "vtt" : undefined;
}
