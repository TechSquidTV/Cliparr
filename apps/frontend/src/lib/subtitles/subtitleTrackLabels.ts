import { subtitleTrackSupportsBurnIn } from "@/lib/subtitles/selectPreferredSubtitleTrack";
import type { PlaybackSubtitleTrack } from "@/providers/types";

interface SubtitleTrackLabelParts {
  title?: string;
  language?: string;
  codec?: string;
  flags: string[];
}

function isPresent(value: string | null | undefined): value is string {
  return Boolean(value);
}

function trimmedText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function subtitleTrackLabelParts(
  track: PlaybackSubtitleTrack,
): SubtitleTrackLabelParts {
  return {
    title: trimmedText(track.title),
    language: trimmedText(track.languageCode)?.toUpperCase(),
    codec: trimmedText(track.codec)?.toUpperCase(),
    flags: [
      track.isForced ? "Forced" : null,
      track.isHearingImpaired ? "SDH" : null,
      track.isDefault ? "Default" : null,
      track.isExternal ? "External" : null,
      subtitleTrackSupportsBurnIn(track) ? null : "Unsupported",
    ].filter(isPresent),
  };
}
