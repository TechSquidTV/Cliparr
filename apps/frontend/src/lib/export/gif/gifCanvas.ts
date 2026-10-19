interface GifCanvasResources {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

export function createGifCanvas(
  width: number,
  height: number,
): GifCanvasResources {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Could not create a GIF rendering canvas.");
  }

  return { canvas, context };
}

export function configureGifCanvasContext(context: CanvasRenderingContext2D) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
}
