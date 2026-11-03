import { isVideoCrop, type VideoCrop } from "#/lib/videoCrop";

export interface EditorCropState {
  region: VideoCrop | null;
  aspectRatio: number | null;
}

export const EMPTY_EDITOR_CROP: EditorCropState = {
  region: null,
  aspectRatio: null,
};

export function isEditorCropState(value: unknown): value is EditorCropState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const crop = value as Partial<EditorCropState>;
  return (
    (crop.region === null || isVideoCrop(crop.region)) &&
    (crop.aspectRatio === null ||
      (typeof crop.aspectRatio === "number" &&
        Number.isFinite(crop.aspectRatio) &&
        crop.aspectRatio > 0))
  );
}

export function editorCropsEqual(a: EditorCropState, b: EditorCropState) {
  if (a.aspectRatio !== b.aspectRatio) {
    return false;
  }
  if (a.region === b.region) {
    return true;
  }
  if (!a.region || !b.region) {
    return false;
  }
  return (
    a.region.x === b.region.x &&
    a.region.y === b.region.y &&
    a.region.width === b.region.width &&
    a.region.height === b.region.height &&
    a.region.sourceAspectRatio === b.region.sourceAspectRatio
  );
}
