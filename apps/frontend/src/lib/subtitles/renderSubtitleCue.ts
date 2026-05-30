import type { SubtitleCue, SubtitleStyleSettings } from "@/lib/subtitles/types";

interface SubtitleLayout {
  font: string;
  fontSize: number;
  lineHeight: number;
  wrappedLines: string[];
}

const subtitleLayoutCache = new Map<string, SubtitleLayout>();
const SUBTITLE_LAYOUT_CACHE_LIMIT = 120;

function scaledValue(value: number, canvasHeight: number) {
  return value * (canvasHeight / 1080);
}

function wrapLine(
  context: CanvasRenderingContext2D,
  line: string,
  maxWidth: number,
) {
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const wrapped: string[] = [];
  let currentLine = words[0] ?? "";

  for (const word of words.slice(1)) {
    const nextLine = `${currentLine} ${word}`;
    if (context.measureText(nextLine).width <= maxWidth) {
      currentLine = nextLine;
      continue;
    }

    wrapped.push(currentLine);
    currentLine = word;
  }

  wrapped.push(currentLine);
  return wrapped;
}

function cueLayoutKey(
  cue: SubtitleCue,
  style: SubtitleStyleSettings,
  canvasWidth: number,
  canvasHeight: number,
  fontSize: number,
  maxWidth: number,
) {
  return JSON.stringify([
    cue.id,
    cue.startTime,
    cue.endTime,
    cue.lines,
    canvasWidth,
    canvasHeight,
    maxWidth,
    fontSize,
    style.fontFamily,
    style.lineHeight,
  ]);
}

function cachedSubtitleLayout(
  context: CanvasRenderingContext2D,
  cue: SubtitleCue,
  style: SubtitleStyleSettings,
  canvasWidth: number,
  canvasHeight: number,
  fontSize: number,
  maxWidth: number,
) {
  const key = cueLayoutKey(
    cue,
    style,
    canvasWidth,
    canvasHeight,
    fontSize,
    maxWidth,
  );
  const cached = subtitleLayoutCache.get(key);
  if (cached) {
    return cached;
  }

  const font = `700 ${fontSize}px ${style.fontFamily}`;
  context.font = font;
  const wrappedLines = cue.lines.flatMap((line) =>
    wrapLine(context, line, maxWidth),
  );
  const layout: SubtitleLayout = {
    font,
    fontSize,
    lineHeight: fontSize * style.lineHeight,
    wrappedLines,
  };

  subtitleLayoutCache.set(key, layout);
  if (subtitleLayoutCache.size > SUBTITLE_LAYOUT_CACHE_LIMIT) {
    const oldestKey = subtitleLayoutCache.keys().next().value;
    if (oldestKey) {
      subtitleLayoutCache.delete(oldestKey);
    }
  }

  return layout;
}

export function renderSubtitleCue(
  context: CanvasRenderingContext2D,
  cue: SubtitleCue,
  style: SubtitleStyleSettings,
  canvasWidth: number,
  canvasHeight: number,
) {
  const fontSize = Math.max(12, scaledValue(style.fontSize, canvasHeight));
  const strokeWidth = Math.max(0, scaledValue(style.strokeWidth, canvasHeight));
  const shadowBlur = Math.max(0, scaledValue(style.shadowBlur, canvasHeight));
  const shadowOffsetY = scaledValue(style.shadowOffsetY, canvasHeight);
  const bottomMargin = Math.max(
    0,
    scaledValue(style.bottomMargin, canvasHeight),
  );
  const maxWidth = canvasWidth * 0.84;
  const layout = cachedSubtitleLayout(
    context,
    cue,
    style,
    canvasWidth,
    canvasHeight,
    fontSize,
    maxWidth,
  );

  context.save();
  context.font = layout.font;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.lineJoin = "round";
  context.miterLimit = 2;

  if (layout.wrappedLines.length === 0) {
    context.restore();
    return;
  }

  const totalHeight = layout.lineHeight * layout.wrappedLines.length;
  const startY = canvasHeight - bottomMargin - totalHeight;
  const x = canvasWidth / 2;

  if (strokeWidth > 0) {
    context.strokeStyle = style.strokeColor;
    context.lineWidth = strokeWidth;
    context.shadowColor = "transparent";

    layout.wrappedLines.forEach((line, index) => {
      context.strokeText(line, x, startY + layout.lineHeight * index);
    });
  }

  context.fillStyle = style.fontColor;
  context.shadowColor = style.shadowColor;
  context.shadowBlur = shadowBlur;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = shadowOffsetY;

  layout.wrappedLines.forEach((line, index) => {
    context.fillText(line, x, startY + layout.lineHeight * index);
  });

  context.restore();
}
