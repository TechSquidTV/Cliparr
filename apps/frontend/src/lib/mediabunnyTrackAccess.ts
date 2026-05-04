import type { InputAudioTrack, InputTrack, InputVideoTrack } from "mediabunny";

interface VideoTrackDimensions {
  width: number;
  height: number;
}

export async function describeInputTrack(track: InputTrack) {
  const [codec, internalCodecId, name] = await Promise.all([
    track.getCodec(),
    track.getInternalCodecId(),
    track.getName(),
  ]);
  const label = `${track.type} ${track.number}`;
  const formattedName = name ? ` "${name}"` : "";

  return `${label}${formattedName} (${String(codec ?? internalCodecId ?? "unknown codec")})`;
}

export async function getTrackLanguageCode(track: InputTrack) {
  return track.getLanguageCode();
}

export async function getTrackName(track: InputTrack) {
  return track.getName();
}

export async function getTrackCodec(track: InputTrack) {
  return track.getCodec();
}

export async function getVideoTrackDimensions(track: InputVideoTrack): Promise<VideoTrackDimensions> {
  const [width, height] = await Promise.all([
    track.getDisplayWidth(),
    track.getDisplayHeight(),
  ]);

  return { width, height };
}

export async function getAudioTrackSampleRate(track: InputAudioTrack) {
  return track.getSampleRate();
}
