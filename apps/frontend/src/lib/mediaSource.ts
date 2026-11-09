import type { EditorMediaSource } from "#/components/editor/editorMedia";

const HLS_PLAYLIST_PATTERN = /\.m3u8(?:$|[#?])/i;

export function isHlsPlaylistUrl(url: string) {
  return HLS_PLAYLIST_PATTERN.test(url);
}

export function isHlsMediaSource(source: EditorMediaSource) {
  return (
    source.kind === "url" &&
    (source.hls === true || isHlsPlaylistUrl(source.url))
  );
}
