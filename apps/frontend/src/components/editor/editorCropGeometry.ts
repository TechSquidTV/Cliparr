import type { MediaDimensions } from "#/components/editor/editorMedia";
import type { VideoCrop } from "#/lib/videoCrop";

type CropRectangle = Pick<VideoCrop, "x" | "y" | "width" | "height">;
export type CropAnchor = Pick<VideoCrop, "x" | "y">;

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

/** Clamp movement or anchored resizing, including a pointer crossing its anchor. */
export function constrainCropRectangle(
  rectangle: CropRectangle,
  bounds: MediaDimensions,
  anchor: CropAnchor | null = null,
  aspectRatio: number | null = null,
): CropRectangle {
  if (!anchor) {
    const width = clamp(rectangle.width, bounds.width);
    const height = clamp(rectangle.height, bounds.height);
    return {
      x: clamp(rectangle.x, bounds.width - width),
      y: clamp(rectangle.y, bounds.height - height),
      width,
      height,
    };
  }
  const west = rectangle.x < anchor.x;
  const north = rectangle.y < anchor.y;
  let width = clamp(rectangle.width, west ? anchor.x : bounds.width - anchor.x);
  let height = clamp(
    rectangle.height,
    north ? anchor.y : bounds.height - anchor.y,
  );
  if (aspectRatio) {
    width = Math.min(width, height * aspectRatio);
    height = width / aspectRatio;
  }
  return {
    x: west ? anchor.x - width : anchor.x,
    y: north ? anchor.y - height : anchor.y,
    width,
    height,
  };
}

export function cropRectangle(
  region: VideoCrop | null,
  bounds: MediaDimensions,
): CropRectangle {
  return {
    x: (region?.x ?? 0) * bounds.width,
    y: (region?.y ?? 0) * bounds.height,
    width: (region?.width ?? 1) * bounds.width,
    height: (region?.height ?? 1) * bounds.height,
  };
}

export function cropRegion(
  rectangle: CropRectangle,
  bounds: MediaDimensions,
): VideoCrop | null {
  const bounded = constrainCropRectangle(rectangle, bounds);
  if (
    bounded.x === 0 &&
    bounded.y === 0 &&
    bounded.width === bounds.width &&
    bounded.height === bounds.height
  ) {
    return null;
  }
  return {
    x: bounded.x / bounds.width,
    y: bounded.y / bounds.height,
    width: bounded.width / bounds.width,
    height: bounded.height / bounds.height,
    sourceAspectRatio: bounds.width / bounds.height,
  };
}

export function cropWithAspectRatio(
  region: VideoCrop | null,
  bounds: MediaDimensions,
  aspectRatio: number,
): VideoCrop | null {
  const previous = cropRectangle(region, bounds);
  const width = Math.min(previous.width, previous.height * aspectRatio);
  const height = width / aspectRatio;
  return cropRegion(
    {
      x: previous.x + (previous.width - width) / 2,
      y: previous.y + (previous.height - height) / 2,
      width,
      height,
    },
    bounds,
  );
}
