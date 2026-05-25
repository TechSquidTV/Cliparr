import type { PlaybackSubtitleTrack } from "../../providers/types";
import {
  subtitleTrackSupportsBurnIn,
  subtitleTrackUnavailableMessage,
} from "../../lib/selectPreferredSubtitleTrack";

interface BuildSubtitleExportSummaryOptions {
  selectedSubtitleTrack: PlaybackSubtitleTrack | null;
  subtitleEnabled: boolean;
  subtitleTrackCount: number;
  clippedSubtitleCueCount: number;
  subtitleLoading: boolean;
  subtitleError: string | null;
  providerId: string;
}

export interface SubtitleExportSummary {
  label: string;
  detail: string;
  tone: "muted" | "ready" | "warning";
  disabledReason: string | null;
}

function subtitleTrackDisplayName(track: PlaybackSubtitleTrack | null) {
  if (!track) {
    return "No subtitle track selected";
  }

  return track.title?.trim()
    || track.languageCode?.trim()?.toUpperCase()
    || "Selected subtitle track";
}

export function buildSubtitleExportSummary({
  selectedSubtitleTrack,
  subtitleEnabled,
  subtitleTrackCount,
  clippedSubtitleCueCount,
  subtitleLoading,
  subtitleError,
  providerId,
}: BuildSubtitleExportSummaryOptions): SubtitleExportSummary {
  if (!selectedSubtitleTrack || !subtitleEnabled) {
    return {
      label: "Not included",
      detail: subtitleTrackCount > 0
        ? "Subtitle burn-in is currently turned off for this export."
        : "No supported text subtitle tracks are available for this session.",
      tone: "muted",
      disabledReason: null,
    };
  }

  const trackName = subtitleTrackDisplayName(selectedSubtitleTrack);

  if (!subtitleTrackSupportsBurnIn(selectedSubtitleTrack)) {
    return {
      label: "Unsupported track",
      detail: subtitleTrackUnavailableMessage(selectedSubtitleTrack, providerId)
        ?? `${trackName} cannot be burned in yet because it is not an exposed text subtitle stream.`,
      tone: "warning",
      disabledReason: "Choose a supported text subtitle track or turn subtitle burn-in off.",
    };
  }

  if (subtitleLoading) {
    return {
      label: "Loading cues",
      detail: `${trackName} is still being prepared for burn-in.`,
      tone: "warning",
      disabledReason: "Subtitles are still loading. Please wait for the cue list to finish loading.",
    };
  }

  if (subtitleError) {
    return {
      label: "Subtitle issue",
      detail: subtitleError,
      tone: "warning",
      disabledReason: subtitleError,
    };
  }

  if (clippedSubtitleCueCount === 0) {
    return {
      label: "No cues found",
      detail: `${trackName} has no subtitle cues inside the selected clip range.`,
      tone: "muted",
      disabledReason: null,
    };
  }

  return {
    label: "Burned in",
    detail: `${trackName} will be rendered into the exported video frames.`,
    tone: "ready",
    disabledReason: null,
  };
}
