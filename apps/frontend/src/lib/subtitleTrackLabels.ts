import { subtitleTrackSupportsBurnIn } from "@/lib/selectPreferredSubtitleTrack";
import type { PlaybackSubtitleTrack } from "@/providers/types";

type SubtitleTrackLabelVariant = "selector" | "summary" | "timeline";

interface SubtitleTrackLabelOptions {
  variant?: SubtitleTrackLabelVariant;
}

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

function subtitleTrackLabelParts(
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

export function formatSubtitleTrackLabel(
  track: PlaybackSubtitleTrack,
  { variant = "summary" }: SubtitleTrackLabelOptions = {},
) {
  const parts = subtitleTrackLabelParts(track);

  if (variant === "selector") {
    const baseLabel = parts.title ?? parts.language ?? "Unnamed subtitle track";
    const detailParts = [
      parts.title && parts.language ? parts.language : null,
      parts.codec,
      parts.flags.join(" · ") || null,
    ].filter(isPresent);

    return detailParts.length > 0
      ? `${baseLabel} (${detailParts.join(" | ")})`
      : baseLabel;
  }

  if (variant === "timeline") {
    return (
      [parts.title, parts.language].filter(isPresent).join(" / ") ||
      "Subtitle track"
    );
  }

  return parts.title ?? parts.language ?? "Selected subtitle track";
}

export function formatSubtitleTrackTechnicalSummary(
  track: PlaybackSubtitleTrack,
) {
  const parts = subtitleTrackLabelParts(track);

  return [
    parts.codec ?? "Unknown codec",
    parts.language,
    track.isForced ? "Forced" : null,
    track.isHearingImpaired ? "SDH" : null,
  ]
    .filter(isPresent)
    .join(" · ");
}
