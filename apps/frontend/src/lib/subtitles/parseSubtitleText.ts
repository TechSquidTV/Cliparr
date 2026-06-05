import type { SubtitleCue } from "@/lib/subtitles/types";

type SubtitleTextFormat = "vtt" | "srt";

function normalizeSubtitleText(text: string) {
  return text.replace(/^\uFEFF/, "").replaceAll(/\r\n?/g, "\n");
}

function decodeEntities(text: string) {
  return text
    .replaceAll(/&nbsp;/gi, " ")
    .replaceAll(/&amp;/gi, "&")
    .replaceAll(/&lt;/gi, "<")
    .replaceAll(/&gt;/gi, ">")
    .replaceAll(/&quot;/gi, '"')
    .replaceAll(/&#39;/gi, "'");
}

function cleanCueText(text: string) {
  return decodeEntities(text.replaceAll(/<[^>]+>/g, "")).trim();
}

function parseTimestamp(timestamp: string) {
  const normalized = timestamp.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return;
  }

  const secondsPart = parts.at(-1);
  if (!secondsPart) {
    return;
  }

  const wholeAndFraction = secondsPart.split(".");
  if (wholeAndFraction.length !== 2) {
    return;
  }

  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  const minutes = Number(parts.at(-2));
  const seconds = Number(wholeAndFraction[0]);
  const milliseconds = Number(wholeAndFraction[1].padEnd(3, "0").slice(0, 3));

  if (
    ![hours, minutes, seconds, milliseconds].every((value) =>
      Number.isFinite(value),
    )
  ) {
    return;
  }

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function cueFromLines(lines: string[]): SubtitleCue | undefined {
  const trimmedLines = lines.map((line) => line.trimEnd());
  const timingIndex = trimmedLines.findIndex((line) => line.includes("-->"));
  if (timingIndex === -1) {
    return undefined;
  }

  const timingLine = trimmedLines[timingIndex];
  const match = timingLine.match(/([\d,.:]+)\s+-->\s+([\d,.:]+)/);
  if (!match) {
    return undefined;
  }

  const startTime = parseTimestamp(match[1]);
  const endTime = parseTimestamp(match[2]);
  if (
    startTime === undefined ||
    endTime === undefined ||
    endTime <= startTime
  ) {
    return undefined;
  }

  const cueId =
    timingIndex > 0 ? trimmedLines[0].trim() || undefined : undefined;
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
    if (
      !firstLine ||
      firstLine === "WEBVTT" ||
      firstLine.startsWith("NOTE") ||
      firstLine === "STYLE" ||
      firstLine === "REGION"
    ) {
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

export function parseSubtitleText(
  text: string,
  format?: string,
): SubtitleCue[] {
  const normalizedFormat = format?.trim().toLowerCase();
  let cues: SubtitleCue[];

  if (normalizedFormat === "vtt" || normalizedFormat === "webvtt") {
    cues = parseVtt(text);
  } else if (normalizedFormat === "srt" || normalizedFormat === "subrip") {
    cues = parseSrt(text);
  } else if (detectSubtitleTextFormat(text) === "vtt") {
    cues = parseVtt(text);
  } else {
    cues = parseSrt(text);
  }

  return cues.toSorted((left, right) => left.startTime - right.startTime);
}
