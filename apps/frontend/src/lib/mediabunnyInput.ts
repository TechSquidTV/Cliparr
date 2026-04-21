import type { Input } from "mediabunny";

const HLS_PLAYLIST_PATTERN = /\.m3u8(?:$|[?#])/i;

export function isHlsPlaylistUrl(url: string) {
  return HLS_PLAYLIST_PATTERN.test(url);
}

export async function createCliparrInputFromUrl(url: string): Promise<Input> {
  const { ALL_FORMATS, HLS_FORMATS, createInputFrom } = await import("mediabunny");

  return createInputFrom(url, isHlsPlaylistUrl(url) ? HLS_FORMATS : ALL_FORMATS);
}
