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
import { formatSubtitleTrackLabel } from "@/lib/subtitleTrackLabels";
import { trimSubtitleCues } from "@/lib/subtitles/trimSubtitleCues";
import type { PlaybackSubtitleTrack } from "@/providers/types";
import { buildSubtitleExportSummary } from "@/components/editor/subtitleExportSummary";
import {
  applySubtitleCueTimingUpdates,
  buildSubtitleTimelineTrack,
  subtitleTimelineTrackToCues,
  type SubtitleCueTimingUpdate,
  type SubtitleTimelineTrack,
} from "@/components/editor/subtitleTimeline";
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
  const [subtitleTimelineTrack, setSubtitleTimelineTrack] =
    useState<SubtitleTimelineTrack | null>(null);

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
    subtitleCues: downloadedSubtitleCues,
    subtitleLoading,
    subtitleError,
    loadedSubtitleTrackKey,
    resetSubtitleCues,
    clearSubtitleError,
  } = useSubtitleCues({
    selectedSubtitleTrack,
    subtitleEnabled,
    providerId: session.source.providerId,
  });
  const selectedDownloadedSubtitleCues = useMemo(
    () =>
      loadedSubtitleTrackKey === selectedSubtitleTrackKey
        ? downloadedSubtitleCues
        : [],
    [downloadedSubtitleCues, loadedSubtitleTrackKey, selectedSubtitleTrackKey],
  );
  const subtitleCues = useMemo(
    () =>
      subtitleTimelineTrack
        ? subtitleTimelineTrackToCues(subtitleTimelineTrack)
        : selectedDownloadedSubtitleCues,
    [selectedDownloadedSubtitleCues, subtitleTimelineTrack],
  );
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
    setSubtitleTimelineTrack(null);
  }, [session.id, selectedSubtitleTrackKey]);

  useEffect(() => {
    if (
      !selectedSubtitleTrack ||
      loadedSubtitleTrackKey !== selectedSubtitleTrackKey ||
      downloadedSubtitleCues.length === 0
    ) {
      return;
    }

    const trackKey = selectedSubtitleTrackKey;
    setSubtitleTimelineTrack((current) => {
      if (current?.trackKey === trackKey) {
        return current;
      }

      return buildSubtitleTimelineTrack({
        trackKey,
        label: formatSubtitleTrackLabel(selectedSubtitleTrack, {
          variant: "timeline",
        }),
        cues: downloadedSubtitleCues,
      });
    });
  }, [
    downloadedSubtitleCues,
    loadedSubtitleTrackKey,
    selectedSubtitleTrack,
    selectedSubtitleTrackKey,
  ]);

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

  const updateSubtitleCueTimings = useCallback(
    (updates: readonly SubtitleCueTimingUpdate[], duration: number) => {
      setSubtitleTimelineTrack((current) =>
        applySubtitleCueTimingUpdates({
          track: current,
          updates,
          duration,
        }),
      );
    },
    [],
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
    subtitleTimelineTrack,
    clippedSubtitleCues,
    subtitleExportSummary,
    handleSelectedSubtitleTrackChange,
    updateSubtitleCueTimings,
  };
}
