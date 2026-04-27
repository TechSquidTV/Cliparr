import type { SubtitleCue, SubtitleStyleSettings } from "./types";

function scaledValue(value: number, canvasHeight: number) {
  return value * (canvasHeight / 1080);
}

function wrapLine(context: CanvasRenderingContext2D, line: string, maxWidth: number) {
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

export function renderSubtitleCue(
  context: CanvasRenderingContext2D,
  cue: SubtitleCue,
  style: SubtitleStyleSettings,
  canvasWidth: number,
  canvasHeight: number
) {
  const fontSize = Math.max(12, scaledValue(style.fontSize, canvasHeight));
  const strokeWidth = Math.max(0, scaledValue(style.strokeWidth, canvasHeight));
  const shadowBlur = Math.max(0, scaledValue(style.shadowBlur, canvasHeight));
  const shadowOffsetY = scaledValue(style.shadowOffsetY, canvasHeight);
  const bottomMargin = Math.max(0, scaledValue(style.bottomMargin, canvasHeight));
  const lineHeight = fontSize * style.lineHeight;
  const maxWidth = canvasWidth * 0.84;

  context.save();
  context.font = `700 ${fontSize}px ${style.fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.lineJoin = "round";
  context.miterLimit = 2;

  const wrappedLines = cue.lines.flatMap((line) => wrapLine(context, line, maxWidth));
  if (wrappedLines.length === 0) {
    context.restore();
    return;
  }

  const totalHeight = lineHeight * wrappedLines.length;
  const startY = canvasHeight - bottomMargin - totalHeight;
  const x = canvasWidth / 2;

  if (strokeWidth > 0) {
    context.strokeStyle = style.strokeColor;
    context.lineWidth = strokeWidth;
    context.shadowColor = "transparent";

    wrappedLines.forEach((line, index) => {
      context.strokeText(line, x, startY + (lineHeight * index));
    });
  }

  context.fillStyle = style.fontColor;
  context.shadowColor = style.shadowColor;
  context.shadowBlur = shadowBlur;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = shadowOffsetY;

  wrappedLines.forEach((line, index) => {
    context.fillText(line, x, startY + (lineHeight * index));
  });

  context.restore();
}
