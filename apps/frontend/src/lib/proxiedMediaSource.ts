import { cliparrClient } from "@/api/cliparrClient";
import type { EditorUrlMediaSource } from "@/components/editor/editorMedia";

export async function resolveProxiedMediaUrl(
  url: string,
  hls: boolean,
): Promise<EditorUrlMediaSource> {
  const proxied = await cliparrClient.createLocalMediaUrl(url);
  return {
    kind: "url",
    role: "direct-url",
    label: hls ? "HLS URL" : "URL",
    originalUrl: url,
    url: proxied.mediaUrl,
    hls: hls || proxied.hls,
  };
}
