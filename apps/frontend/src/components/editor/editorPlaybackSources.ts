import type { InputAudioTrack, InputVideoTrack } from "mediabunny";
import { isHlsPlaylistUrl } from "../../lib/mediabunnyInput";
import {
  getTrackCodec,
  getTrackLanguageCode,
  getTrackName,
} from "../../lib/mediabunnyTrackAccess";
import type { PlaybackAudioSelection } from "../../providers/types";
import { errorMessage, isAc3FamilyCodec } from "./EditorUtils";

export interface PlaybackSourceCandidate {
  label: "hls stream" | "direct source";
  url: string;
}

export interface PlaybackLoadFailure {
  label: PlaybackSourceCandidate["label"];
  message: string;
  classification: "hls-playlist" | "unknown";
  category: "open-or-read" | "preview-only" | "shared-export-blocking";
}

export interface PlaybackFallbackInfo {
  category: PlaybackLoadFailure["category"];
  message: string;
}

export interface PlaybackSourceAnalysisContext {
  sessionId: string;
  source: PlaybackSourceCandidate["label"];
  url: string;
  selectedAudioTrack?: PlaybackAudioSelection;
  videoTracks: readonly InputVideoTrack[];
  allAudioTracks: readonly InputAudioTrack[];
  sourceVideoTrack: InputVideoTrack | null;
  previewVideoTrack: InputVideoTrack | null;
  sourceAudioTrack: InputAudioTrack | null;
  previewAudioTrack: InputAudioTrack | null;
  previewAudioWarning?: string;
  warnings: string[];
  isLivePlayback: boolean;
}

export class PlaybackSourceError extends Error {
  category: PlaybackLoadFailure["category"];

  constructor(category: PlaybackLoadFailure["category"], message: string) {
    super(message);
    this.name = "PlaybackSourceError";
    this.category = category;
  }
}

export function buildPlaybackSourceCandidates(hlsUrl: string | undefined, mediaUrl: string | undefined) {
  const candidates: PlaybackSourceCandidate[] = [];

  if (hlsUrl) {
    candidates.push({ label: "hls stream", url: hlsUrl });
  }

  if (mediaUrl && !candidates.some((candidate) => candidate.url === mediaUrl)) {
    candidates.push({ label: "direct source", url: mediaUrl });
  }

  return candidates;
}

export function classifyPlaybackSource(source: Pick<PlaybackSourceCandidate, "label" | "url">): PlaybackLoadFailure["classification"] {
  return source.label === "hls stream" || isHlsPlaylistUrl(source.url) ? "hls-playlist" : "unknown";
}

export function buildPlaybackFailure(source: PlaybackSourceCandidate, err: unknown): PlaybackLoadFailure {
  return {
    label: source.label,
    message: errorMessage(err),
    classification: classifyPlaybackSource(source),
    category: err instanceof PlaybackSourceError ? err.category : "open-or-read",
  };
}

export function shouldUseExportFallback(failure: PlaybackLoadFailure) {
  return failure.category === "open-or-read" || failure.category === "shared-export-blocking";
}

export function describePlaybackFailure(failure: PlaybackLoadFailure) {
  const prefix = failure.label === "hls stream" ? "HLS stream" : "Direct source";

  return `${prefix} failed: ${failure.message}`;
}

export function formatPlaybackSourceLabel(label: PlaybackSourceCandidate["label"]) {
  return label === "hls stream" ? "HLS stream" : "Direct source";
}

export function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function finiteNonNegativeDuration(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function resolvePlaybackDuration(
  playbackSource: PlaybackSourceCandidate,
  computedDuration: number,
  initialDuration: number,
) {
  const fallbackDuration = finiteNonNegativeDuration(initialDuration);
  const normalizedComputedDuration = finiteNonNegativeDuration(computedDuration);

  if (playbackSource.label === "hls stream") {
    return Math.max(fallbackDuration, normalizedComputedDuration);
  }

  return normalizedComputedDuration || fallbackDuration;
}

export function buildPlaybackLoadError(failures: PlaybackLoadFailure[]) {
  if (failures.length === 0) {
    return "Playback could not be loaded.";
  }

  if (failures.length === 1) {
    return describePlaybackFailure(failures[0]);
  }

  const uniqueMessages = [...new Set(failures.map((failure) => failure.message))];
  if (uniqueMessages.length === 1) {
    return `Cliparr could not open any playback stream. ${uniqueMessages[0]}`;
  }

  return `Cliparr could not open any playback stream. ${failures.map(describePlaybackFailure).join(" ")}`;
}

export function browserDecoderEnvironmentWarning() {
  const missingDecoders = [
    "VideoDecoder" in window ? null : "video",
    "AudioDecoder" in window ? null : "audio",
  ].filter(isPresent);

  if (missingDecoders.length === 0) {
    return undefined;
  }

  if (!window.isSecureContext) {
    return `Browser WebCodecs ${missingDecoders.join(" and ")} decoding is unavailable from ${window.location.origin}. Open Cliparr over HTTPS, localhost, or 127.0.0.1 so the editor can decode media. Jellyfin playback can still work on this origin because its native player does not use the same editor decoder APIs.`;
  }

  return `Browser WebCodecs ${missingDecoders.join(" and ")} decoding is unavailable in this browser.`;
}

async function assessPreviewVideoTrack(track: InputVideoTrack | null) {
  if (!track) {
    return { track: null, warning: undefined };
  }

  const videoCodec = await getTrackCodec(track);
  if (videoCodec === null) {
    return {
      track: null,
      warning: "Video codec is unknown.",
    };
  }

  if (!(await track.canDecode())) {
    return {
      track: null,
      warning: `Cannot decode ${videoCodec} video in this browser.`,
    };
  }

  return { track, warning: undefined };
}

export async function selectPreviewVideoTrack(videoTracks: readonly InputVideoTrack[]) {
  const sourceVideoTrack = videoTracks[0] ?? null;
  if (!sourceVideoTrack) {
    return {
      sourceVideoTrack: null,
      previewVideoTrack: null,
      warnings: [] as string[],
    };
  }

  const warnings: string[] = [];
  const primaryAssessment = await assessPreviewVideoTrack(sourceVideoTrack);
  if (primaryAssessment.track) {
    return {
      sourceVideoTrack,
      previewVideoTrack: primaryAssessment.track,
      warnings,
    };
  }

  if (primaryAssessment.warning) {
    warnings.push(primaryAssessment.warning);
  }

  for (const candidate of videoTracks.slice(1)) {
    const candidateAssessment = await assessPreviewVideoTrack(candidate);
    if (candidateAssessment.track) {
      return {
        sourceVideoTrack,
        previewVideoTrack: candidateAssessment.track,
        warnings,
      };
    }
  }

  return {
    sourceVideoTrack,
    previewVideoTrack: null,
    warnings,
  };
}

export async function assessPreviewAudioTrack(track: InputAudioTrack | null) {
  if (!track) {
    return { track: null, warning: undefined };
  }

  const audioCodec = await getTrackCodec(track);
  if (audioCodec === null) {
    return {
      track: null,
      warning: "Audio codec is unknown.",
    };
  }

  if (!(await track.canDecode()) && !isAc3FamilyCodec(audioCodec)) {
    return {
      track: null,
      warning: `Cannot decode ${audioCodec} audio in this browser.`,
    };
  }

  return { track, warning: undefined };
}

async function summarizeVideoTrackForDebug(track: InputVideoTrack | null) {
  if (!track) {
    return null;
  }

  const [codec, title, canDecode] = await Promise.all([
    getTrackCodec(track),
    getTrackName(track),
    track.canDecode().catch(() => null),
  ]);

  return {
    trackNumber: track.number,
    codec: codec ?? null,
    title: title ?? null,
    canDecode,
  };
}

async function summarizeAudioTrackForDebug(track: InputAudioTrack | null) {
  if (!track) {
    return null;
  }

  const [codec, title, languageCode, canDecode] = await Promise.all([
    getTrackCodec(track),
    getTrackName(track),
    getTrackLanguageCode(track),
    track.canDecode().catch(() => null),
  ]);

  return {
    trackNumber: track.number,
    codec: codec ?? null,
    title: title ?? null,
    languageCode: languageCode ?? null,
    canDecode,
  };
}

async function summarizeAudioTracksForDebug(tracks: readonly InputAudioTrack[]) {
  return Promise.all(tracks.map((track) => summarizeAudioTrackForDebug(track)));
}

export async function buildPlaybackSourceAnalysis(context: PlaybackSourceAnalysisContext) {
  const [
    allAudioTracks,
    sourceVideoTrack,
    previewVideoTrack,
    sourceAudioTrack,
    previewAudioTrack,
  ] = await Promise.all([
    summarizeAudioTracksForDebug(context.allAudioTracks),
    summarizeVideoTrackForDebug(context.sourceVideoTrack),
    summarizeVideoTrackForDebug(context.previewVideoTrack),
    summarizeAudioTrackForDebug(context.sourceAudioTrack),
    summarizeAudioTrackForDebug(context.previewAudioTrack),
  ]);

  return {
    sessionId: context.sessionId,
    source: context.source,
    urlClassification: classifyPlaybackSource({
      label: context.source,
      url: context.url,
    }),
    selectedAudioTrack: context.selectedAudioTrack ?? null,
    videoTrackCount: context.videoTracks.length,
    audioTrackCount: context.allAudioTracks.length,
    allAudioTracks,
    sourceVideoTrack,
    previewVideoTrack,
    sourceAudioTrack,
    previewAudioTrack,
    previewAudioWarning: context.previewAudioWarning ?? null,
    warnings: [...context.warnings],
    isLivePlayback: context.isLivePlayback,
  } satisfies Record<string, unknown>;
}
