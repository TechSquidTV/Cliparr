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

  return (
    track.title?.trim() ||
    track.languageCode?.trim()?.toUpperCase() ||
    "Selected subtitle track"
  );
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
      detail: !selectedSubtitleTrack
        ? subtitleTrackCount > 0
          ? "No subtitle track selected."
          : "No supported subtitles found."
        : "Subtitles are off.",
      tone: "muted",
      disabledReason: null,
    };
  }

  const trackName = subtitleTrackDisplayName(selectedSubtitleTrack);

  if (!subtitleTrackSupportsBurnIn(selectedSubtitleTrack)) {
    return {
      label: "Not supported",
      detail:
        subtitleTrackUnavailableMessage(selectedSubtitleTrack, providerId) ??
        "This subtitle track is not supported.",
      tone: "warning",
      disabledReason: "Choose another subtitle track or turn subtitles off.",
    };
  }

  if (subtitleLoading) {
    return {
      label: "Loading",
      detail: "Preparing subtitles.",
      tone: "warning",
      disabledReason: "Subtitles are still loading.",
    };
  }

  if (subtitleError) {
    return {
      label: "Issue",
      detail: subtitleError,
      tone: "warning",
      disabledReason: subtitleError,
    };
  }

  if (clippedSubtitleCueCount === 0) {
    return {
      label: "None in range",
      detail: "No subtitles in the selected range.",
      tone: "muted",
      disabledReason: null,
    };
  }

  return {
    label: "Included",
    detail: `${trackName} will be burned in.`,
    tone: "ready",
    disabledReason: null,
  };
}
