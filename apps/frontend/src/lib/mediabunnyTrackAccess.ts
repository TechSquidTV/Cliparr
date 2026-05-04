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

export async function getTrackTimelineOffsetSeconds(
  tracks: ReadonlyArray<InputTrack | null | undefined>
) {
  const presentTracks = tracks.filter((track): track is InputTrack => track !== null && track !== undefined);
  if (presentTracks.length === 0) {
    return 0;
  }

  const usesUnixEpochTimeline = (await Promise.all(
    presentTracks.map((track) => track.isRelativeToUnixEpoch())
  )).some(Boolean);

  if (!usesUnixEpochTimeline) {
    return 0;
  }

  const firstTimestamps = await Promise.all(
    presentTracks.map((track) => track.getFirstTimestamp())
  );

  return Math.min(...firstTimestamps);
}

export function toSourceTimelineTime(displayTimeSeconds: number, timelineOffsetSeconds: number) {
  return displayTimeSeconds + timelineOffsetSeconds;
}

export function fromSourceTimelineTime(sourceTimeSeconds: number, timelineOffsetSeconds: number) {
  return sourceTimeSeconds - timelineOffsetSeconds;
}
