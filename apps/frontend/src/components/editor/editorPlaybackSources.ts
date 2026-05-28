import type { InputAudioTrack, InputVideoTrack } from "mediabunny";
import {
  editorMediaSourcesEqual,
  isHlsEditorMediaSource,
  sourceDisplayLabel,
  type EditorMediaSource,
} from "../../lib/editorMedia";
import {
  getTrackCodec,
  getTrackLanguageCode,
  getTrackName,
} from "../../lib/mediabunnyTrackAccess";
import type { PlaybackAudioSelection } from "../../providers/types";
import { errorMessage, isAc3FamilyCodec } from "./EditorUtils";

type PlaybackSourceLabel = "hls stream" | "direct source" | "local file" | "url" | "hls url";

export interface PlaybackSourceCandidate {
  label: PlaybackSourceLabel;
  source: EditorMediaSource;
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
  mediaSource: EditorMediaSource;
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

function playbackLabelForSource(source: EditorMediaSource, role: "hls" | "direct") {
  if (source.role === "local-file") {
    return "local file" satisfies PlaybackSourceLabel;
  }

  if (source.role === "direct-url") {
    return isHlsEditorMediaSource(source)
      ? "hls url" satisfies PlaybackSourceLabel
      : "url" satisfies PlaybackSourceLabel;
  }

  return role === "hls"
    ? "hls stream" satisfies PlaybackSourceLabel
    : "direct source" satisfies PlaybackSourceLabel;
}

export function buildPlaybackSourceCandidates(
  hlsSource: EditorMediaSource | undefined,
  directSource: EditorMediaSource | undefined,
) {
  const candidates: PlaybackSourceCandidate[] = [];

  if (hlsSource) {
    candidates.push({ label: playbackLabelForSource(hlsSource, "hls"), source: hlsSource });
  }

  if (directSource && !candidates.some((candidate) => editorMediaSourcesEqual(candidate.source, directSource))) {
    candidates.push({ label: playbackLabelForSource(directSource, "direct"), source: directSource });
  }

  return candidates;
}

function classifyPlaybackSource(source: Pick<PlaybackSourceCandidate, "label" | "source">): PlaybackLoadFailure["classification"] {
  return source.label === "hls stream"
    || source.label === "hls url"
    || isHlsEditorMediaSource(source.source)
    ? "hls-playlist"
    : "unknown";
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
  const prefix = formatPlaybackSourceLabel(failure.label);

  return `${prefix} failed: ${failure.message}`;
}

export function formatPlaybackSourceLabel(label: PlaybackSourceCandidate["label"]) {
  switch (label) {
    case "hls stream":
      return "HLS stream";
    case "direct source":
      return "Direct source";
    case "local file":
      return "Local file";
    case "hls url":
      return "HLS URL";
    case "url":
      return "URL";
  }
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

  if (playbackSource.label === "hls stream" || playbackSource.label === "hls url") {
    return Math.max(fallbackDuration, normalizedComputedDuration);
  }

  return normalizedComputedDuration || fallbackDuration;
}

export function buildPlaybackLoadError(failures: PlaybackLoadFailure[]) {
  if (failures.length === 0) {
    return "Playback failed.";
  }

  if (failures.length === 1) {
    return describePlaybackFailure(failures[0]);
  }

  const uniqueMessages = [...new Set(failures.map((failure) => failure.message))];
  if (uniqueMessages.length === 1) {
    return `Playback failed. ${uniqueMessages[0]}`;
  }

  return `Playback failed. ${failures.map(describePlaybackFailure).join(" ")}`;
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
    return `Browser decoding is blocked on ${window.location.origin}. Open Cliparr over HTTPS, localhost, or 127.0.0.1.`;
  }

  return `Browser ${missingDecoders.join(" and ")} decoding is unavailable.`;
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
      source: context.mediaSource,
    }),
    sourceLabel: sourceDisplayLabel(context.mediaSource),
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
