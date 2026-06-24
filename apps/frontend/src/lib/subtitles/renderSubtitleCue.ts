import type { SubtitleCue, SubtitleStyleSettings } from "#/lib/subtitles/types";

interface SubtitleLayout {
  font: string;
  fontSize: number;
  lineHeight: number;
  wrappedLines: string[];
  lineWidths: number[];
}

interface SubtitleLayerBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SubtitleLayer {
  canvas: HTMLCanvasElement;
  bounds: SubtitleLayerBounds;
}

interface SubtitleCueRenderMetrics {
  fontSize: number;
  strokeWidth: number;
  shadowBlur: number;
  shadowOffsetY: number;
  bottomMargin: number;
  layout: SubtitleLayout;
}

const subtitleLayoutCache = new Map<string, SubtitleLayout>();
const SUBTITLE_LAYOUT_CACHE_LIMIT = 120;
const subtitleLayerCache = new Map<string, SubtitleLayer>();
const SUBTITLE_LAYER_CACHE_LIMIT = 8;
const SUBTITLE_SUPERSAMPLE_SCALE = 2;

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
  const { wrappedLines, lineWidths } = (() => {
    context.save();
    try {
      context.font = font;
      const wrappedLines = cue.lines.flatMap((line) =>
        wrapLine(context, line, maxWidth),
      );
      return {
        wrappedLines,
        lineWidths: wrappedLines.map((line) => context.measureText(line).width),
      };
    } finally {
      context.restore();
    }
  })();

  const layout: SubtitleLayout = {
    font,
    fontSize,
    lineHeight: fontSize * style.lineHeight,
    wrappedLines,
    lineWidths,
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

export function resolveSubtitleLayerBounds({
  canvasWidth,
  canvasHeight,
  centerX,
  startY,
  maxLineWidth,
  totalHeight,
  strokeWidth,
  shadowBlur,
  shadowOffsetY,
}: {
  canvasWidth: number;
  canvasHeight: number;
  centerX: number;
  startY: number;
  maxLineWidth: number;
  totalHeight: number;
  strokeWidth: number;
  shadowBlur: number;
  shadowOffsetY: number;
}): SubtitleLayerBounds {
  const strokePadding = strokeWidth / 2;
  const padX = Math.ceil(strokePadding + shadowBlur + 2);
  const padTop = Math.ceil(
    strokePadding + shadowBlur + Math.max(0, -shadowOffsetY) + 2,
  );
  const padBottom = Math.ceil(
    strokePadding + shadowBlur + Math.max(0, shadowOffsetY) + 2,
  );
  const halfWidth = Math.max(1, maxLineWidth) / 2;
  const left = Math.max(0, Math.floor(centerX - halfWidth - padX));
  const top = Math.max(0, Math.floor(startY - padTop));
  const right = Math.min(canvasWidth, Math.ceil(centerX + halfWidth + padX));
  const bottom = Math.min(
    canvasHeight,
    Math.ceil(startY + totalHeight + padBottom),
  );

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function cueLayerKey({
  cue,
  style,
  canvasWidth,
  canvasHeight,
  fontSize,
  strokeWidth,
  shadowBlur,
  shadowOffsetY,
  bottomMargin,
}: {
  cue: SubtitleCue;
  style: SubtitleStyleSettings;
  canvasWidth: number;
  canvasHeight: number;
  fontSize: number;
  strokeWidth: number;
  shadowBlur: number;
  shadowOffsetY: number;
  bottomMargin: number;
}) {
  return JSON.stringify([
    cue.id,
    cue.startTime,
    cue.endTime,
    cue.lines,
    canvasWidth,
    canvasHeight,
    fontSize,
    style.fontFamily,
    style.fontColor,
    style.lineHeight,
    style.strokeColor,
    strokeWidth,
    style.shadowColor,
    shadowBlur,
    shadowOffsetY,
    bottomMargin,
    SUBTITLE_SUPERSAMPLE_SCALE,
  ]);
}

function cacheSubtitleLayer(key: string, layer: SubtitleLayer) {
  subtitleLayerCache.set(key, layer);
  if (subtitleLayerCache.size > SUBTITLE_LAYER_CACHE_LIMIT) {
    const oldestKey = subtitleLayerCache.keys().next().value;
    if (oldestKey) {
      subtitleLayerCache.delete(oldestKey);
    }
  }
}

function renderSupersampledSubtitleLayer({
  context,
  cue,
  style,
  layout,
  canvasWidth,
  canvasHeight,
  strokeWidth,
  shadowBlur,
  shadowOffsetY,
  bottomMargin,
}: {
  context: CanvasRenderingContext2D;
  cue: SubtitleCue;
  style: SubtitleStyleSettings;
  layout: SubtitleLayout;
  canvasWidth: number;
  canvasHeight: number;
  strokeWidth: number;
  shadowBlur: number;
  shadowOffsetY: number;
  bottomMargin: number;
}): SubtitleLayer | null {
  const key = cueLayerKey({
    cue,
    style,
    canvasWidth,
    canvasHeight,
    fontSize: layout.fontSize,
    strokeWidth,
    shadowBlur,
    shadowOffsetY,
    bottomMargin,
  });
  const cached = subtitleLayerCache.get(key);
  if (cached) {
    return cached;
  }

  const totalHeight = layout.lineHeight * layout.wrappedLines.length;
  const startY = canvasHeight - bottomMargin - totalHeight;
  const centerX = canvasWidth / 2;
  const maxLineWidth = Math.max(1, ...layout.lineWidths);
  const bounds = resolveSubtitleLayerBounds({
    canvasWidth,
    canvasHeight,
    centerX,
    startY,
    maxLineWidth,
    totalHeight,
    strokeWidth,
    shadowBlur,
    shadowOffsetY,
  });
  const ownerDocument = context.canvas.ownerDocument;
  if (!ownerDocument) {
    return null;
  }

  const layerCanvas = ownerDocument.createElement("canvas");
  layerCanvas.width = Math.max(
    1,
    Math.ceil(bounds.width * SUBTITLE_SUPERSAMPLE_SCALE),
  );
  layerCanvas.height = Math.max(
    1,
    Math.ceil(bounds.height * SUBTITLE_SUPERSAMPLE_SCALE),
  );

  const layerContext = layerCanvas.getContext("2d");
  if (!layerContext) {
    return null;
  }

  const scale = SUBTITLE_SUPERSAMPLE_SCALE;
  const localX = (centerX - bounds.left) * scale;
  const localStartY = (startY - bounds.top) * scale;
  const scaledLineHeight = layout.lineHeight * scale;

  layerContext.save();
  layerContext.font = `700 ${layout.fontSize * scale}px ${style.fontFamily}`;
  layerContext.textAlign = "center";
  layerContext.textBaseline = "top";
  layerContext.lineJoin = "round";
  layerContext.miterLimit = 2;

  if (strokeWidth > 0) {
    layerContext.strokeStyle = style.strokeColor;
    layerContext.lineWidth = strokeWidth * scale;
    layerContext.shadowColor = "transparent";

    for (const [index, line] of layout.wrappedLines.entries()) {
      layerContext.strokeText(
        line,
        localX,
        localStartY + scaledLineHeight * index,
      );
    }
  }

  layerContext.fillStyle = style.fontColor;
  layerContext.shadowColor = style.shadowColor;
  layerContext.shadowBlur = shadowBlur * scale;
  layerContext.shadowOffsetX = 0;
  layerContext.shadowOffsetY = shadowOffsetY * scale;

  for (const [index, line] of layout.wrappedLines.entries()) {
    layerContext.fillText(line, localX, localStartY + scaledLineHeight * index);
  }

  layerContext.restore();

  const layer = {
    canvas: layerCanvas,
    bounds,
  };
  cacheSubtitleLayer(key, layer);
  return layer;
}

function drawSubtitleLayer(
  context: CanvasRenderingContext2D,
  layer: SubtitleLayer,
) {
  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    layer.canvas,
    layer.bounds.left,
    layer.bounds.top,
    layer.bounds.width,
    layer.bounds.height,
  );
  context.restore();
}

function drawDirectSubtitleText({
  context,
  layout,
  style,
  canvasWidth,
  canvasHeight,
  strokeWidth,
  shadowBlur,
  shadowOffsetY,
  bottomMargin,
}: {
  context: CanvasRenderingContext2D;
  layout: SubtitleLayout;
  style: SubtitleStyleSettings;
  canvasWidth: number;
  canvasHeight: number;
  strokeWidth: number;
  shadowBlur: number;
  shadowOffsetY: number;
  bottomMargin: number;
}) {
  const totalHeight = layout.lineHeight * layout.wrappedLines.length;
  const startY = canvasHeight - bottomMargin - totalHeight;
  const x = canvasWidth / 2;

  if (strokeWidth > 0) {
    context.strokeStyle = style.strokeColor;
    context.lineWidth = strokeWidth;
    context.shadowColor = "transparent";

    for (const [index, line] of layout.wrappedLines.entries()) {
      context.strokeText(line, x, startY + layout.lineHeight * index);
    }
  }

  context.fillStyle = style.fontColor;
  context.shadowColor = style.shadowColor;
  context.shadowBlur = shadowBlur;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = shadowOffsetY;

  for (const [index, line] of layout.wrappedLines.entries()) {
    context.fillText(line, x, startY + layout.lineHeight * index);
  }
}

function resolveSubtitleCueRenderMetrics({
  context,
  cue,
  style,
  canvasWidth,
  canvasHeight,
}: {
  context: CanvasRenderingContext2D;
  cue: SubtitleCue;
  style: SubtitleStyleSettings;
  canvasWidth: number;
  canvasHeight: number;
}): SubtitleCueRenderMetrics {
  const fontSize = Math.max(12, scaledValue(style.fontSize, canvasHeight));
  const strokeWidth = Math.max(0, scaledValue(style.strokeWidth, canvasHeight));
  const shadowBlur = Math.max(0, scaledValue(style.shadowBlur, canvasHeight));
  const shadowOffsetY = scaledValue(style.shadowOffsetY, canvasHeight);
  const bottomMargin = Math.max(
    0,
    scaledValue(style.bottomMargin, canvasHeight),
  );
  const maxWidth = canvasWidth * 0.84;

  return {
    fontSize,
    strokeWidth,
    shadowBlur,
    shadowOffsetY,
    bottomMargin,
    layout: cachedSubtitleLayout(
      context,
      cue,
      style,
      canvasWidth,
      canvasHeight,
      fontSize,
      maxWidth,
    ),
  };
}

function renderSubtitleCueWithMetrics({
  context,
  cue,
  style,
  canvasWidth,
  canvasHeight,
  metrics,
}: {
  context: CanvasRenderingContext2D;
  cue: SubtitleCue;
  style: SubtitleStyleSettings;
  canvasWidth: number;
  canvasHeight: number;
  metrics: SubtitleCueRenderMetrics;
}) {
  const { strokeWidth, shadowBlur, shadowOffsetY, bottomMargin, layout } =
    metrics;

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

  const layer = renderSupersampledSubtitleLayer({
    context,
    cue,
    style,
    layout,
    canvasWidth,
    canvasHeight,
    strokeWidth,
    shadowBlur,
    shadowOffsetY,
    bottomMargin,
  });
  if (layer) {
    drawSubtitleLayer(context, layer);
  } else {
    drawDirectSubtitleText({
      context,
      layout,
      style,
      canvasWidth,
      canvasHeight,
      strokeWidth,
      shadowBlur,
      shadowOffsetY,
      bottomMargin,
    });
  }

  context.restore();
}

export function renderSubtitleCue(
  context: CanvasRenderingContext2D,
  cue: SubtitleCue,
  style: SubtitleStyleSettings,
  canvasWidth: number,
  canvasHeight: number,
) {
  const metrics = resolveSubtitleCueRenderMetrics({
    context,
    cue,
    style,
    canvasWidth,
    canvasHeight,
  });
  renderSubtitleCueWithMetrics({
    context,
    cue,
    style,
    canvasWidth,
    canvasHeight,
    metrics,
  });
}

export function renderSubtitleCues(
  context: CanvasRenderingContext2D,
  cues: readonly SubtitleCue[],
  style: SubtitleStyleSettings,
  canvasWidth: number,
  canvasHeight: number,
) {
  for (const cue of cues) {
    renderSubtitleCue(context, cue, style, canvasWidth, canvasHeight);
  }
}
