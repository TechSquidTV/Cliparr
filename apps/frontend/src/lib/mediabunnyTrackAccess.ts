import type {
  InputAudioTrack,
  InputTrack,
  InputVideoTrack,
  VideoCodec,
} from "mediabunny";

interface VideoTrackDimensions {
  width: number;
  height: number;
}

export interface VideoTrackDecodabilityAssessment {
  codec: VideoCodec | null;
  canDecode: boolean;
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

export async function assessVideoTrackDecodability(
  track: InputVideoTrack,
): Promise<VideoTrackDecodabilityAssessment> {
  const codec = await track.getCodec();

  return {
    codec,
    canDecode: codec !== null && (await track.canDecode()),
  };
}

export function videoTrackPreviewUnavailableMessage(
  decodability: VideoTrackDecodabilityAssessment,
) {
  if (decodability.codec === null) {
    return "Preview unavailable: this browser cannot decode the source video track because its codec is unknown.";
  }

  return `Preview unavailable: this browser cannot decode ${decodability.codec} video.`;
}

export function videoTrackExportUnsupportedMessage(
  decodability: VideoTrackDecodabilityAssessment,
) {
  if (decodability.codec === null) {
    return "This browser cannot decode the source video track because its codec is unknown.";
  }

  return `This browser cannot decode ${decodability.codec} video. Try Chrome or Edge, or use a source video codec this browser supports.`;
}

export async function getVideoTrackDimensions(
  track: InputVideoTrack,
): Promise<VideoTrackDimensions> {
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
  tracks: ReadonlyArray<InputTrack | null | undefined>,
) {
  const presentTracks = tracks.filter(
    (track): track is InputTrack => track !== null && track !== undefined,
  );
  if (presentTracks.length === 0) {
    return 0;
  }

  const [relativeToUnixEpochStates, liveStates] = await Promise.all([
    Promise.all(presentTracks.map((track) => track.isRelativeToUnixEpoch())),
    Promise.all(presentTracks.map((track) => track.isLive())),
  ]);
  const usesUnixEpochTimeline = relativeToUnixEpochStates.some(Boolean);
  const usesLiveTimeline = liveStates.some(Boolean);

  if (!usesUnixEpochTimeline && !usesLiveTimeline) {
    return 0;
  }

  const firstTimestamps = await Promise.all(
    presentTracks.map((track) => track.getFirstTimestamp()),
  );

  return Math.max(0, Math.min(...firstTimestamps));
}

export function toSourceTimelineTime(
  displayTimeSeconds: number,
  timelineOffsetSeconds: number,
) {
  return displayTimeSeconds + timelineOffsetSeconds;
}

export function fromSourceTimelineTime(
  sourceTimeSeconds: number,
  timelineOffsetSeconds: number,
) {
  return sourceTimeSeconds - timelineOffsetSeconds;
}
