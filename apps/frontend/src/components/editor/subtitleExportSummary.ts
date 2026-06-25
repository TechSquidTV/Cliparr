import type { PlaybackSubtitleTrack } from "@/providers/types";
import {
  subtitleTrackSupportsBurnIn,
  subtitleTrackUnavailableMessage,
} from "@/lib/selectPreferredSubtitleTrack";
import { formatSubtitleTrackLabel } from "@/lib/subtitleTrackLabels";

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
    let detail = "No supported subtitles found.";
    if (selectedSubtitleTrack) {
      detail = "Subtitles are off.";
    } else if (subtitleTrackCount > 0) {
      detail = "No subtitle track selected.";
    }

    return {
      label: "Not included",
      detail,
      tone: "muted",
      disabledReason: null,
    };
  }

  const trackName = formatSubtitleTrackLabel(selectedSubtitleTrack, {
    variant: "summary",
  });

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
