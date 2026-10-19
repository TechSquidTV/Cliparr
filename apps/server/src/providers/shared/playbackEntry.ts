import type { CurrentlyPlayingItem } from "@cliparr/shared/providers";

type CurrentlyPlayingItemFields = Omit<
  CurrentlyPlayingItem,
  "previewUrl" | "previewFormat"
> & {
  previewPath?: string;
};

export function assembleCurrentlyPlayingItem({
  previewPath,
  ...fields
}: CurrentlyPlayingItemFields): CurrentlyPlayingItem {
  return {
    ...fields,
    previewUrl: fields.hlsUrl,
    previewFormat: previewPath ? "hls" : undefined,
  };
}
