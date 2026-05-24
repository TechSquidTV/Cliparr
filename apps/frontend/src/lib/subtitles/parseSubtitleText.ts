import type { SubtitleCue } from "./types";

type SubtitleTextFormat = "vtt" | "srt";

function normalizeSubtitleText(text: string) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function cleanCueText(text: string) {
  return decodeEntities(text.replace(/<[^>]+>/g, "")).trim();
}

function parseTimestamp(timestamp: string) {
  const normalized = timestamp.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return undefined;
  }

  const secondsPart = parts[parts.length - 1];
  const wholeAndFraction = secondsPart.split(".");
  if (wholeAndFraction.length !== 2) {
    return undefined;
  }

  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  const minutes = Number(parts[parts.length - 2]);
  const seconds = Number(wholeAndFraction[0]);
  const milliseconds = Number(wholeAndFraction[1].padEnd(3, "0").slice(0, 3));

  if (![hours, minutes, seconds, milliseconds].every((value) => Number.isFinite(value))) {
    return undefined;
  }

  return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
}

function cueFromLines(lines: string[]): SubtitleCue | undefined {
  const trimmedLines = lines.map((line) => line.trimEnd());
  const timingIndex = trimmedLines.findIndex((line) => line.includes("-->"));
  if (timingIndex < 0) {
    return undefined;
  }

  const timingLine = trimmedLines[timingIndex];
  const match = timingLine.match(/([0-9:.,]+)\s+-->\s+([0-9:.,]+)/);
  if (!match) {
    return undefined;
  }

  const startTime = parseTimestamp(match[1]);
  const endTime = parseTimestamp(match[2]);
  if (startTime === undefined || endTime === undefined || endTime <= startTime) {
    return undefined;
  }

  const cueId = timingIndex > 0 ? trimmedLines[0].trim() || undefined : undefined;
  const textLines = trimmedLines
    .slice(timingIndex + 1)
    .map((line) => cleanCueText(line))
    .filter(Boolean);
  if (textLines.length === 0) {
    return undefined;
  }

  return {
    id: cueId,
    startTime,
    endTime,
    text: textLines.join("\n"),
    lines: textLines,
  };
}

function parseVtt(text: string) {
  const normalized = normalizeSubtitleText(text);
  const blocks = normalized.split(/\n{2,}/);

  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line, index) => index > 0 || line.trim() !== "");
    if (lines.length === 0) {
      continue;
    }

    const firstLine = lines[0]?.trim();
    if (!firstLine || firstLine === "WEBVTT" || firstLine.startsWith("NOTE") || firstLine === "STYLE" || firstLine === "REGION") {
      continue;
    }

    const cue = cueFromLines(lines);
    if (cue) {
      cues.push(cue);
    }
  }

  return cues;
}

function parseSrt(text: string) {
  const normalized = normalizeSubtitleText(text);
  const blocks = normalized.split(/\n{2,}/);

  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== "");
    if (lines.length === 0) {
      continue;
    }

    const cue = cueFromLines(lines);
    if (cue) {
      cues.push(cue);
    }
  }

  return cues;
}

function detectSubtitleTextFormat(text: string): SubtitleTextFormat {
  return normalizeSubtitleText(text).startsWith("WEBVTT") ? "vtt" : "srt";
}

export function parseSubtitleText(text: string, format?: string): SubtitleCue[] {
  const normalizedFormat = format?.trim().toLowerCase();
  const cues = normalizedFormat === "vtt" || normalizedFormat === "webvtt"
    ? parseVtt(text)
    : normalizedFormat === "srt" || normalizedFormat === "subrip"
      ? parseSrt(text)
      : detectSubtitleTextFormat(text) === "vtt"
        ? parseVtt(text)
        : parseSrt(text);

  return cues.sort((left, right) => left.startTime - right.startTime);
}
