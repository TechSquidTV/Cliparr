export interface NormalizedSubtitleCueText {
  text: string;
  lines: string[];
}

export function normalizeSubtitleCueText(
  text: string,
): NormalizedSubtitleCueText | null {
  const lines = text
    .replaceAll(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  return {
    text: lines.join("\n"),
    lines,
  };
}
