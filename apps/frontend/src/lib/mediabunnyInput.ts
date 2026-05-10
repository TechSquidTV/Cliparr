import type { Input } from "mediabunny";

const HLS_PLAYLIST_PATTERN = /\.m3u8(?:$|[?#])/i;
const HLS_URL_SOURCE_OPTIONS = {
  maxCacheSize: 64 * 1024 * 1024,
  parallelism: 2,
} as const;

export function isHlsPlaylistUrl(url: string) {
  return HLS_PLAYLIST_PATTERN.test(url);
}

export async function createCliparrInputFromUrl(
  url: string,
  options: { hls?: boolean } = {},
): Promise<Input> {
  const { ALL_FORMATS, HLS_FORMATS, Input, UrlSource } = await import("mediabunny");
  const isHlsSource = options.hls ?? isHlsPlaylistUrl(url);

  return new Input({
    source: new UrlSource(url, isHlsSource ? HLS_URL_SOURCE_OPTIONS : undefined),
    formats: isHlsSource ? HLS_FORMATS : ALL_FORMATS,
  });
}
