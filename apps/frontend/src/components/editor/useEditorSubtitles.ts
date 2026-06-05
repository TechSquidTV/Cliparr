import { useCallback, useEffect, useMemo, useState } from "react";
import type { EditorSession } from "@/lib/editorMedia";
import {
  selectPreferredSubtitleTrack,
  subtitleTrackKey,
  subtitleTrackSupportsBurnIn,
} from "@/lib/selectPreferredSubtitleTrack";
import {
  loadSubtitleStyleSettings,
  saveSubtitleStyleSettings,
} from "@/lib/subtitles/settings";
import { trimSubtitleCues } from "@/lib/subtitles/trimSubtitleCues";
import type { PlaybackSubtitleTrack } from "@/providers/types";
import { buildSubtitleExportSummary } from "@/components/editor/subtitleExportSummary";
import { useSubtitleCues } from "@/components/editor/useSubtitleCues";

interface UseEditorSubtitlesProperties {
  session: EditorSession;
  startTime: number;
  endTime: number;
}

export function useEditorSubtitles({
  session,
  startTime,
  endTime,
}: UseEditorSubtitlesProperties) {
  const [subtitleStyleSettings, setSubtitleStyleSettings] = useState(() =>
    loadSubtitleStyleSettings(),
  );
  const [subtitleEnabled, setSubtitleEnabled] = useState(false);
  const [selectedSubtitleTrackKey, setSelectedSubtitleTrackKey] =
    useState("none");

  const subtitleTracks = useMemo<PlaybackSubtitleTrack[]>(
    () =>
      session.local
        ? []
        : (session.subtitleTracks ?? []).filter((track) =>
            subtitleTrackSupportsBurnIn(track),
          ),
    [session.local, session.subtitleTracks],
  );
  const selectedSubtitleTrack = useMemo(() => {
    if (selectedSubtitleTrackKey === "none") {
      return null;
    }

    return (
      subtitleTracks.find(
        (track) => subtitleTrackKey(track) === selectedSubtitleTrackKey,
      ) ?? null
    );
  }, [selectedSubtitleTrackKey, subtitleTracks]);
  const {
    subtitleCues,
    subtitleLoading,
    subtitleError,
    resetSubtitleCues,
    clearSubtitleError,
  } = useSubtitleCues({
    selectedSubtitleTrack,
    subtitleEnabled,
    providerId: session.source.providerId,
  });
  const subtitlePreviewEnabled =
    subtitleEnabled &&
    subtitleTrackSupportsBurnIn(selectedSubtitleTrack) &&
    subtitleCues.length > 0;
  const clippedSubtitleCues = useMemo(
    () =>
      subtitleEnabled ? trimSubtitleCues(subtitleCues, startTime, endTime) : [],
    [endTime, startTime, subtitleCues, subtitleEnabled],
  );
  const subtitleExportSummary = useMemo(
    () =>
      buildSubtitleExportSummary({
        selectedSubtitleTrack,
        subtitleEnabled,
        subtitleTrackCount: subtitleTracks.length,
        clippedSubtitleCueCount: clippedSubtitleCues.length,
        subtitleLoading,
        subtitleError,
        providerId: session.source.providerId,
      }),
    [
      selectedSubtitleTrack,
      subtitleEnabled,
      subtitleTracks.length,
      clippedSubtitleCues.length,
      subtitleLoading,
      subtitleError,
      session.source.providerId,
    ],
  );

  useEffect(() => {
    saveSubtitleStyleSettings(subtitleStyleSettings);
  }, [subtitleStyleSettings]);

  useEffect(() => {
    const preferredSubtitleTrack = selectPreferredSubtitleTrack(
      subtitleTracks,
      session.selectedSubtitleTrack,
    );

    setSelectedSubtitleTrackKey(
      preferredSubtitleTrack
        ? subtitleTrackKey(preferredSubtitleTrack)
        : "none",
    );
    setSubtitleEnabled(
      Boolean(
        preferredSubtitleTrack &&
        subtitleTrackSupportsBurnIn(preferredSubtitleTrack),
      ),
    );
    resetSubtitleCues();
  }, [
    session.id,
    session.selectedSubtitleTrack,
    subtitleTracks,
    resetSubtitleCues,
  ]);

  const handleSelectedSubtitleTrackChange = useCallback(
    (value: string) => {
      setSelectedSubtitleTrackKey(value);
      clearSubtitleError();

      if (value === "none") {
        setSubtitleEnabled(false);
        resetSubtitleCues();
        return;
      }

      const nextTrack =
        subtitleTracks.find((track) => subtitleTrackKey(track) === value) ??
        null;
      setSubtitleEnabled(
        Boolean(nextTrack && subtitleTrackSupportsBurnIn(nextTrack)),
      );
    },
    [clearSubtitleError, resetSubtitleCues, subtitleTracks],
  );

  return {
    subtitleTracks,
    selectedSubtitleTrack,
    selectedSubtitleTrackKey,
    subtitleEnabled,
    setSubtitleEnabled,
    subtitleStyleSettings,
    setSubtitleStyleSettings,
    subtitleCues,
    subtitleLoading,
    subtitleError,
    subtitlePreviewEnabled,
    clippedSubtitleCues,
    subtitleExportSummary,
    handleSelectedSubtitleTrackChange,
  };
}
