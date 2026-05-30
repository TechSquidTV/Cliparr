export type FramegrabImageFormat = "png" | "jpg" | "webp";

export interface FramegrabImageFormatOption {
  value: FramegrabImageFormat;
  label: string;
  extension: string;
  mimeType: string;
}

export const FRAMEGRAB_IMAGE_QUALITY = 0.92;

export const framegrabImageFormatOptions: readonly FramegrabImageFormatOption[] =
  [
    {
      value: "png",
      label: "PNG",
      extension: ".png",
      mimeType: "image/png",
    },
    {
      value: "jpg",
      label: "JPEG",
      extension: ".jpg",
      mimeType: "image/jpeg",
    },
    {
      value: "webp",
      label: "WEBP",
      extension: ".webp",
      mimeType: "image/webp",
    },
  ];

export function framegrabFormatOptionFor(format: FramegrabImageFormat) {
  return (
    framegrabImageFormatOptions.find((option) => option.value === format) ??
    framegrabImageFormatOptions[0]
  );
}

export function framegrabMimeTypeFor(format: FramegrabImageFormat) {
  return framegrabFormatOptionFor(format).mimeType;
}

export function framegrabExtensionFor(format: FramegrabImageFormat) {
  return framegrabFormatOptionFor(format).extension;
}

export function cloneCanvasFrame(sourceCanvas: HTMLCanvasElement) {
  if (sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
    throw new Error("No preview frame is available yet.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a framegrab canvas.");
  }

  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function encodeFramegrabCanvas(
  canvas: HTMLCanvasElement,
  format: FramegrabImageFormat,
) {
  return new Promise<Blob>((resolve, reject) => {
    const mimeType = framegrabMimeTypeFor(format);
    const quality = format === "png" ? undefined : FRAMEGRAB_IMAGE_QUALITY;

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not encode the frame image."));
          return;
        }

        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

export async function copyFramegrabCanvasToClipboard(
  canvas: HTMLCanvasElement,
) {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === "undefined"
  ) {
    throw new Error(
      "Clipboard image copying is not available in this browser.",
    );
  }

  const blob = await encodeFramegrabCanvas(canvas, "png");
  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type]: blob,
    }),
  ]);
}
