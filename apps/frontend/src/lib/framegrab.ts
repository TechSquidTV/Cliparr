export type FramegrabImageFormat = "png" | "jpg" | "webp";
export type FramegrabImageQuality = "high" | "balanced" | "compact";

export interface FramegrabImageFormatOption {
  value: FramegrabImageFormat;
  label: string;
  extension: string;
  mimeType: string;
}

export interface FramegrabImageQualityOption {
  value: FramegrabImageQuality;
  label: string;
  quality: number;
}

export const DEFAULT_FRAMEGRAB_IMAGE_QUALITY: FramegrabImageQuality = "high";

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

export const framegrabImageQualityOptions: readonly FramegrabImageQualityOption[] =
  [
    {
      value: "high",
      label: "High",
      quality: 0.92,
    },
    {
      value: "balanced",
      label: "Balanced",
      quality: 0.82,
    },
    {
      value: "compact",
      label: "Compact",
      quality: 0.68,
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

export function framegrabQualityOptionFor(quality: FramegrabImageQuality) {
  return (
    framegrabImageQualityOptions.find((option) => option.value === quality) ??
    framegrabImageQualityOptions[0]
  );
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
  imageQuality: FramegrabImageQuality = DEFAULT_FRAMEGRAB_IMAGE_QUALITY,
) {
  return new Promise<Blob>((resolve, reject) => {
    const mimeType = framegrabMimeTypeFor(format);
    const quality =
      format === "png"
        ? undefined
        : framegrabQualityOptionFor(imageQuality).quality;

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not encode the frame image."));
          return;
        }

        if (blob.type.toLowerCase() !== mimeType) {
          reject(new Error(`Could not encode the frame image as ${mimeType}.`));
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
