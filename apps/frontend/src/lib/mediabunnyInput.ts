import type { Input } from "mediabunny";
import type { EditorMediaSource } from "@/lib/editorMedia";

const HLS_PLAYLIST_PATTERN = /\.m3u8(?:$|[?#])/i;
const HLS_URL_SOURCE_OPTIONS = {
  maxCacheSize: 64 * 1024 * 1024,
  parallelism: 2,
} as const;

export function isHlsPlaylistUrl(url: string) {
  return HLS_PLAYLIST_PATTERN.test(url);
}

function isHlsMediaSource(source: EditorMediaSource) {
  return (
    source.kind === "url" &&
    (source.hls === true || isHlsPlaylistUrl(source.url))
  );
}

export async function createCliparrInputFromSource(
  source: EditorMediaSource,
  options: { hls?: boolean } = {},
): Promise<Input> {
  const { ALL_FORMATS, BlobSource, HLS_FORMATS, Input, UrlSource } =
    await import("mediabunny");
  const isHlsSource = options.hls ?? isHlsMediaSource(source);
  const inputSource =
    source.kind === "url"
      ? new UrlSource(
          source.url,
          isHlsSource ? HLS_URL_SOURCE_OPTIONS : undefined,
        )
      : new BlobSource(
          source.kind === "file" ? source.file : await source.handle.getFile(),
        );

  return new Input({
    source: inputSource,
    formats: isHlsSource ? HLS_FORMATS : ALL_FORMATS,
  });
}
