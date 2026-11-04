import type { MediaDimensions } from "#/components/editor/editorMedia";

/** A rectangle in the oriented picture, independent of playback resolution. */
export interface VideoCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceAspectRatio: number;
}

export function isVideoCrop(value: unknown): value is VideoCrop {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const crop = value as Partial<VideoCrop>;
  return (
    typeof crop.x === "number" &&
    Number.isFinite(crop.x) &&
    crop.x >= 0 &&
    typeof crop.y === "number" &&
    Number.isFinite(crop.y) &&
    crop.y >= 0 &&
    typeof crop.width === "number" &&
    Number.isFinite(crop.width) &&
    crop.width > 0 &&
    typeof crop.height === "number" &&
    Number.isFinite(crop.height) &&
    crop.height > 0 &&
    crop.x + crop.width <= 1 + Number.EPSILON &&
    crop.y + crop.height <= 1 + Number.EPSILON &&
    typeof crop.sourceAspectRatio === "number" &&
    Number.isFinite(crop.sourceAspectRatio) &&
    crop.sourceAspectRatio > 0
  );
}

/** Integer bounds shared by export, frame grabs, and preview composition. */
export function resolveVideoCrop(
  crop: VideoCrop | null | undefined,
  dimensions: MediaDimensions | null,
) {
  if (!crop) {
    return null;
  }
  if (!isVideoCrop(crop)) {
    throw new Error(
      "The crop region is invalid. Reset the crop and try again.",
    );
  }
  if (
    !dimensions ||
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width < 1 ||
    dimensions.height < 1
  ) {
    throw new Error("Waiting for video dimensions to apply the crop.");
  }
  // Permit encoding-rounding differences, but never silently reuse a crop on
  // a differently framed source (for example a letterboxed fallback).
  const ratio = dimensions.width / dimensions.height;
  if (Math.abs(ratio / crop.sourceAspectRatio - 1) > 0.01) {
    throw new Error(
      "This source has a different picture shape. Reset the crop before exporting.",
    );
  }
  const width = Math.floor(dimensions.width);
  const height = Math.floor(dimensions.height);
  const left = Math.min(width - 1, Math.round(crop.x * width));
  const top = Math.min(height - 1, Math.round(crop.y * height));
  const right = Math.min(
    width,
    Math.max(left + 1, Math.round((crop.x + crop.width) * width)),
  );
  const bottom = Math.min(
    height,
    Math.max(top + 1, Math.round((crop.y + crop.height) * height)),
  );
  if (left === 0 && top === 0 && right === width && bottom === height) {
    return null;
  }
  return { left, top, width: right - left, height: bottom - top };
}
