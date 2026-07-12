import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fromSeconds,
  useTimeline,
  useTimelineClips,
  useTimelineEditCommands,
  useTimelineTracks,
} from "@techsquidtv/canvas-timeline";
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
import {
  EDITOR_SUBTITLE_TRACK_ID,
  subtitleCueFromTimelineClip,
  subtitleCuesFromTimeline,
  synchronizeEditorTimelineSubtitles,
  type EditorTimelineTrackKind,
} from "@/components/editor/editorTimelineEngine";

interface UseEditorSubtitlesProperties {
  session: EditorSession;
  startTime: number;
  endTime: number;
  duration: number;
  mediaReady: boolean;
}

export function useEditorSubtitles({
  session,
  startTime,
  endTime,
  duration,
  mediaReady,
}: UseEditorSubtitlesProperties) {
  const { engine } = useTimeline();
  const { tracks } = useTimelineTracks<EditorTimelineTrackKind>();
  const { clips, selectedClip, selectedClipTrackId, selectClip, updateClip } =
    useTimelineClips<EditorTimelineTrackKind>();
  const { deleteClip, trimClip } = useTimelineEditCommands();
  const [subtitleStyleSettings, setSubtitleStyleSettings] = useState(() =>
    loadSubtitleStyleSettings(),
  );
  const [subtitleEnabled, setSubtitleEnabled] = useState(false);
  const [selectedSubtitleTrackKey, setSelectedSubtitleTrackKey] =
    useState("none");
  const [importedSubtitleTrackKey, setImportedSubtitleTrackKey] = useState<
    string | null
  >(null);

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
  const subtitleImportRequired =
    subtitleEnabled &&
    selectedSubtitleTrack !== null &&
    importedSubtitleTrackKey !== selectedSubtitleTrackKey;
  const {
    subtitleCues: downloadedSubtitleCues,
    subtitleLoading: downloadedSubtitlesLoading,
    subtitleError,
    loadedSubtitleTrackKey,
    resetSubtitleCues,
    clearSubtitleError,
  } = useSubtitleCues({
    selectedSubtitleTrack,
    subtitleEnabled: subtitleImportRequired,
    providerId: session.source.providerId,
  });
  const selectedDownloadedSubtitleCues = useMemo(
    () =>
      loadedSubtitleTrackKey === selectedSubtitleTrackKey
        ? downloadedSubtitleCues
        : [],
    [downloadedSubtitleCues, loadedSubtitleTrackKey, selectedSubtitleTrackKey],
  );
  const subtitleLoading =
    downloadedSubtitlesLoading ||
    Boolean(subtitleImportRequired && !subtitleError);
  useEffect(() => {
    if (
      !mediaReady ||
      duration <= 0 ||
      !subtitleImportRequired ||
      loadedSubtitleTrackKey !== selectedSubtitleTrackKey
    ) {
      return;
    }

    synchronizeEditorTimelineSubtitles(engine, {
      cues: selectedDownloadedSubtitleCues,
    });
    setImportedSubtitleTrackKey(selectedSubtitleTrackKey);
    resetSubtitleCues();
  }, [
    duration,
    engine,
    loadedSubtitleTrackKey,
    mediaReady,
    resetSubtitleCues,
    selectedDownloadedSubtitleCues,
    selectedSubtitleTrackKey,
    subtitleImportRequired,
  ]);
  const subtitleCues = useMemo(
    () => subtitleCuesFromTimeline(tracks),
    [tracks],
  );
  const subtitleClipEntries = useMemo(
    () => clips.filter((entry) => entry.track.id === EDITOR_SUBTITLE_TRACK_ID),
    [clips],
  );
  const selectedSubtitleClip =
    selectedClipTrackId === EDITOR_SUBTITLE_TRACK_ID ? selectedClip : null;
  const selectedSubtitleCue = selectedSubtitleClip
    ? subtitleCueFromTimelineClip(selectedSubtitleClip)
    : null;
  const subtitleTrackVisible =
    tracks.find((track) => track.id === EDITOR_SUBTITLE_TRACK_ID)?.visible ??
    true;
  const subtitleOutputEnabled = subtitleEnabled && subtitleTrackVisible;
  const subtitleCuesReady =
    selectedSubtitleTrack !== null &&
    importedSubtitleTrackKey === selectedSubtitleTrackKey &&
    !subtitleLoading &&
    !subtitleError;
  const clippedSubtitleCues = useMemo(
    () =>
      subtitleOutputEnabled && subtitleCuesReady
        ? trimSubtitleCues(subtitleCues, startTime, endTime)
        : [],
    [
      endTime,
      startTime,
      subtitleCues,
      subtitleCuesReady,
      subtitleOutputEnabled,
    ],
  );
  const subtitleExportSummary = useMemo(
    () =>
      buildSubtitleExportSummary({
        selectedSubtitleTrack,
        subtitleEnabled: subtitleOutputEnabled,
        subtitleTrackCount: subtitleTracks.length,
        clippedSubtitleCueCount: clippedSubtitleCues.length,
        subtitleLoading,
        subtitleError,
        providerId: session.source.providerId,
      }),
    [
      selectedSubtitleTrack,
      subtitleOutputEnabled,
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
    setImportedSubtitleTrackKey(null);
  }, [
    session.id,
    session.selectedSubtitleTrack,
    subtitleTracks,
    resetSubtitleCues,
  ]);

  const handleSelectedSubtitleTrackChange = useCallback(
    (value: string) => {
      if (
        value !== "none" &&
        value !== importedSubtitleTrackKey &&
        subtitleCues.length > 0 &&
        globalThis.window !== undefined &&
        !globalThis.confirm(
          "Changing subtitle tracks will replace your customized subtitle cues. Continue?",
        )
      ) {
        return;
      }

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
    [
      clearSubtitleError,
      importedSubtitleTrackKey,
      resetSubtitleCues,
      subtitleCues.length,
      subtitleTracks,
    ],
  );

  const handleSelectedSubtitleTextCommit = useCallback(
    (text: string) => {
      if (!selectedSubtitleClip) {
        return;
      }
      const normalizedText = text
        .replaceAll(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim();
      if (normalizedText.length === 0) {
        return;
      }
      updateClip(selectedSubtitleClip.id, { label: normalizedText });
    },
    [selectedSubtitleClip, updateClip],
  );

  const handleSelectedSubtitleStartCommit = useCallback(
    (startTime: number) => {
      if (!selectedSubtitleClip || !Number.isFinite(startTime)) {
        return;
      }
      trimClip({
        clipId: selectedSubtitleClip.id,
        edge: "start",
        // eslint-disable-next-line unicorn/no-keyword-prefix -- Canvas Timeline command field.
        newTime: fromSeconds(Math.min(Math.max(0, startTime), duration)),
        snap: false,
      });
    },
    [duration, selectedSubtitleClip, trimClip],
  );

  const handleSelectedSubtitleEndCommit = useCallback(
    (endTime: number) => {
      if (!selectedSubtitleClip || !Number.isFinite(endTime)) {
        return;
      }
      trimClip({
        clipId: selectedSubtitleClip.id,
        edge: "end",
        // eslint-disable-next-line unicorn/no-keyword-prefix -- Canvas Timeline command field.
        newTime: fromSeconds(Math.min(Math.max(0, endTime), duration)),
        snap: false,
      });
    },
    [duration, selectedSubtitleClip, trimClip],
  );

  const handleDeleteSelectedSubtitle = useCallback(() => {
    if (!selectedSubtitleClip) {
      return;
    }
    const selectedIndex = subtitleClipEntries.findIndex(
      (entry) => entry.clip.id === selectedSubtitleClip.id,
    );
    const nextSelection =
      subtitleClipEntries[selectedIndex + 1] ??
      subtitleClipEntries[selectedIndex - 1] ??
      null;
    deleteClip(selectedSubtitleClip.id);
    selectClip(nextSelection?.clip.id ?? null);
  }, [deleteClip, selectClip, selectedSubtitleClip, subtitleClipEntries]);

  const selectRelativeSubtitleCue = useCallback(
    (offset: -1 | 1) => {
      if (subtitleClipEntries.length === 0) {
        return;
      }
      const selectedIndex = selectedSubtitleClip
        ? subtitleClipEntries.findIndex(
            (entry) => entry.clip.id === selectedSubtitleClip.id,
          )
        : -1;
      const nextIndex = Math.min(
        Math.max(selectedIndex + offset, 0),
        subtitleClipEntries.length - 1,
      );
      selectClip(subtitleClipEntries[nextIndex]?.clip.id ?? null);
    },
    [selectClip, selectedSubtitleClip, subtitleClipEntries],
  );

  const handleSeekToSelectedSubtitle = useCallback(() => {
    if (selectedSubtitleCue) {
      engine.updatePlayhead(fromSeconds(selectedSubtitleCue.startTime));
    }
  }, [engine, selectedSubtitleCue]);

  return {
    subtitleTracks,
    selectedSubtitleTrack,
    selectedSubtitleTrackKey,
    subtitleEnabled,
    subtitleOutputEnabled,
    subtitleCuesReady,
    setSubtitleEnabled,
    subtitleStyleSettings,
    setSubtitleStyleSettings,
    subtitleCues,
    subtitleLoading,
    subtitleError,
    clippedSubtitleCues,
    subtitleExportSummary,
    handleSelectedSubtitleTrackChange,
    selectedSubtitleCue,
    handleSelectedSubtitleTextCommit,
    handleSelectedSubtitleStartCommit,
    handleSelectedSubtitleEndCommit,
    handleDeleteSelectedSubtitle,
    handleSelectPreviousSubtitle: () => selectRelativeSubtitleCue(-1),
    handleSelectNextSubtitle: () => selectRelativeSubtitleCue(1),
    handleSeekToSelectedSubtitle,
  };
}
