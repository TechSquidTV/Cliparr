import type { Input, InputAudioTrack, InputVideoTrack } from "mediabunny";
import type { PlaybackAudioSelection } from "#/providers/types";
import {
  editorMediaSourcesEqual,
  isHlsEditorMediaSource,
  type EditorMediaSource,
} from "@/lib/editorMedia";
import {
  assessVideoTrackDecodability,
  getTrackCodec,
  isPlaybackVideoTrack,
  videoTrackPreviewUnavailableMessage,
} from "@/lib/mediabunnyTrackAccess";
import { isAc3FamilyCodec } from "@/components/editor/editorUtilities";

type PlaybackSourceLabel =
  | "hls stream"
  | "direct source"
  | "local file"
  | "url"
  | "hls url";

export interface PlaybackSourceCandidate {
  label: PlaybackSourceLabel;
  source: EditorMediaSource;
}

export interface PlaybackFallbackInfo {
  message: string;
}

export function playbackAudioSelectionsEqual(
  left: PlaybackAudioSelection | undefined,
  right: PlaybackAudioSelection | undefined,
) {
  return (
    left?.trackNumber === right?.trackNumber &&
    left?.languageCode === right?.languageCode &&
    left?.title === right?.title
  );
}

export function playbackSourceCandidatesEqual(
  left: readonly PlaybackSourceCandidate[],
  right: readonly PlaybackSourceCandidate[],
) {
  return (
    left.length === right.length &&
    left.every((candidate, index) => {
      const otherCandidate = right[index];
      return (
        otherCandidate !== undefined &&
        candidate.label === otherCandidate.label &&
        editorMediaSourcesEqual(candidate.source, otherCandidate.source)
      );
    })
  );
}

function playbackLabelForSource(
  source: EditorMediaSource,
  role: "hls" | "direct",
) {
  if (source.role === "local-file") {
    return "local file" satisfies PlaybackSourceLabel;
  }

  if (source.role === "direct-url") {
    return isHlsEditorMediaSource(source)
      ? ("hls url" satisfies PlaybackSourceLabel)
      : ("url" satisfies PlaybackSourceLabel);
  }

  return role === "hls"
    ? ("hls stream" satisfies PlaybackSourceLabel)
    : ("direct source" satisfies PlaybackSourceLabel);
}

export function buildPlaybackSourceCandidates(
  hlsSource: EditorMediaSource | undefined,
  directSource: EditorMediaSource | undefined,
) {
  const candidates: PlaybackSourceCandidate[] = [];

  if (hlsSource) {
    candidates.push({
      label: playbackLabelForSource(hlsSource, "hls"),
      source: hlsSource,
    });
  }

  if (
    directSource &&
    !candidates.some((candidate) =>
      editorMediaSourcesEqual(candidate.source, directSource),
    )
  ) {
    candidates.push({
      label: playbackLabelForSource(directSource, "direct"),
      source: directSource,
    });
  }

  return candidates;
}

export function formatPlaybackSourceLabel(
  label: PlaybackSourceCandidate["label"],
) {
  switch (label) {
    case "hls stream": {
      return "HLS stream";
    }
    case "direct source": {
      return "Direct source";
    }
    case "local file": {
      return "Local file";
    }
    case "hls url": {
      return "HLS URL";
    }
    case "url": {
      return "URL";
    }
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
  const normalizedComputedDuration =
    finiteNonNegativeDuration(computedDuration);

  if (
    playbackSource.label === "hls stream" ||
    playbackSource.label === "hls url"
  ) {
    return Math.max(fallbackDuration, normalizedComputedDuration);
  }

  return normalizedComputedDuration || fallbackDuration;
}

async function assessPreviewVideoTrack(track: InputVideoTrack | null) {
  if (!track) {
    return { track: null, warning: undefined };
  }

  const decodability = await assessVideoTrackDecodability(track);
  if (decodability.codec === null || !decodability.canDecode) {
    return {
      track: null,
      warning: videoTrackPreviewUnavailableMessage(decodability),
    };
  }

  return { track, warning: undefined };
}

export async function selectPreviewVideoTrack(
  input: Pick<Input, "getPrimaryVideoTrack" | "getVideoTracks">,
) {
  const sourceVideoTrack = await input.getPrimaryVideoTrack({
    filter: isPlaybackVideoTrack,
  });
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

  const videoTracks = await input.getVideoTracks({
    filter: isPlaybackVideoTrack,
  });
  for (const candidate of videoTracks) {
    if (candidate.id === sourceVideoTrack.id) {
      continue;
    }
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
