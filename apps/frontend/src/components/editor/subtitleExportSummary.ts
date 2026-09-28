interface BuildSubtitleExportSummaryOptions {
  subtitleEnabled: boolean;
  clippedSubtitleCueCount: number;
  subtitleLoading: boolean;
}

export interface SubtitleExportSummary {
  label: string;
  detail: string;
  tone: "muted" | "ready" | "warning";
  disabledReason: string | null;
}

export function buildSubtitleExportSummary({
  subtitleEnabled,
  clippedSubtitleCueCount,
  subtitleLoading,
}: BuildSubtitleExportSummaryOptions): SubtitleExportSummary {
  if (subtitleLoading) {
    return {
      label: "Importing",
      detail: "Preparing subtitles. Your current subtitles are preserved.",
      tone: "warning",
      disabledReason: "Subtitles are still loading.",
    };
  }
  if (!subtitleEnabled) {
    return {
      label: "Not included",
      detail: "Subtitles are hidden.",
      tone: "muted",
      disabledReason: null,
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
    detail: `${clippedSubtitleCueCount} subtitle${clippedSubtitleCueCount === 1 ? "" : "s"} will be burned in.`,
    tone: "ready",
    disabledReason: null,
  };
}
