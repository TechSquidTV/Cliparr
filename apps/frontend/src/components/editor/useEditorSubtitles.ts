import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type {
  PlaybackSubtitleSelection,
  PlaybackSubtitleTrack,
} from "@/providers/types";
import {
  normalizeEditableSubtitleCues,
  updateEditableSubtitleCueRanges,
  updateEditableSubtitleCueText,
  type EditableSubtitleCue,
  type SubtitleCueRangeUpdate,
} from "@/components/editor/editorSubtitleCues";
import { buildSubtitleExportSummary } from "@/components/editor/subtitleExportSummary";
import { useSubtitleCues } from "@/components/editor/useSubtitleCues";

interface UseEditorSubtitlesProps {
  session: EditorSession;
  startTime: number;
  endTime: number;
}

function boolSignature(value: boolean | undefined) {
  return value ? "1" : "0";
}

function subtitleTrackImportSignature(track: PlaybackSubtitleTrack) {
  return [
    subtitleTrackKey(track),
    track.languageCode ?? "",
    track.title ?? "",
    track.codec ?? "",
    track.contentFormat ?? "",
    boolSignature(track.isText),
    boolSignature(track.isDefault),
    boolSignature(track.isForced),
    boolSignature(track.isHearingImpaired),
    boolSignature(track.isExternal),
    track.contentUrl ? "content-url" : "no-content-url",
  ].join("\u001f");
}

function subtitleTracksImportSignature(
  tracks: readonly PlaybackSubtitleTrack[],
) {
  return tracks.map(subtitleTrackImportSignature).join("\u001e");
}

function subtitleSelectionSignature(
  selection: PlaybackSubtitleSelection | undefined,
) {
  if (!selection) {
    return "none";
  }

  return [
    selection.streamId ?? "",
    selection.index ?? "",
    selection.languageCode ?? "",
    selection.title ?? "",
    selection.codec ?? "",
    selection.contentFormat ?? "",
    boolSignature(selection.isText),
  ].join("\u001f");
}

export function useEditorSubtitles({
  session,
  startTime,
  endTime,
}: UseEditorSubtitlesProps) {
  const [subtitleStyleSettings, setSubtitleStyleSettings] = useState(() =>
    loadSubtitleStyleSettings(),
  );
  const [subtitleEnabled, setSubtitleEnabled] = useState(false);
  const [selectedSubtitleTrackKey, setSelectedSubtitleTrackKey] =
    useState("none");
  const [editableSubtitleCues, setEditableSubtitleCues] = useState<
    EditableSubtitleCue[]
  >([]);
  const [selectedSubtitleCueId, setSelectedSubtitleCueId] = useState<
    string | null
  >(null);
  const autoSubtitleSelectionSignatureRef = useRef<string | null>(null);

  const subtitleTracks = useMemo<PlaybackSubtitleTrack[]>(
    () => (session.local ? [] : (session.subtitleTracks ?? [])),
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
  const subtitleTracksSignature = useMemo(
    () => subtitleTracksImportSignature(subtitleTracks),
    [subtitleTracks],
  );
  const selectedSubtitleSelectionSignature = useMemo(
    () => subtitleSelectionSignature(session.selectedSubtitleTrack),
    [session.selectedSubtitleTrack],
  );
  const autoSubtitleSelectionSignature = `${session.id}\u001e${selectedSubtitleSelectionSignature}\u001e${subtitleTracksSignature}`;
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
    editableSubtitleCues.length > 0;
  const selectedSubtitleCue = useMemo(
    () =>
      selectedSubtitleCueId
        ? (editableSubtitleCues.find(
            (cue) => cue.id === selectedSubtitleCueId,
          ) ?? null)
        : null,
    [editableSubtitleCues, selectedSubtitleCueId],
  );
  const clippedSubtitleCues = useMemo(
    () =>
      subtitleEnabled
        ? trimSubtitleCues(editableSubtitleCues, startTime, endTime)
        : [],
    [editableSubtitleCues, endTime, startTime, subtitleEnabled],
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
    setEditableSubtitleCues(normalizeEditableSubtitleCues(subtitleCues));
    setSelectedSubtitleCueId(null);
  }, [subtitleCues]);

  useEffect(() => {
    if (
      autoSubtitleSelectionSignatureRef.current ===
      autoSubtitleSelectionSignature
    ) {
      return;
    }
    autoSubtitleSelectionSignatureRef.current = autoSubtitleSelectionSignature;

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
    setEditableSubtitleCues([]);
    setSelectedSubtitleCueId(null);
  }, [
    autoSubtitleSelectionSignature,
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
        setEditableSubtitleCues([]);
        setSelectedSubtitleCueId(null);
        return;
      }

      const nextTrack =
        subtitleTracks.find((track) => subtitleTrackKey(track) === value) ??
        null;
      setSubtitleEnabled(
        Boolean(nextTrack && subtitleTrackSupportsBurnIn(nextTrack)),
      );
      setEditableSubtitleCues([]);
      setSelectedSubtitleCueId(null);
    },
    [clearSubtitleError, resetSubtitleCues, subtitleTracks],
  );

  const handleSubtitleCueSelect = useCallback((cueId: string | null) => {
    setSelectedSubtitleCueId(cueId);
  }, []);

  const handleSubtitleCueTextChange = useCallback(
    (cueId: string, text: string) => {
      setEditableSubtitleCues((currentCues) =>
        updateEditableSubtitleCueText(currentCues, cueId, text),
      );
    },
    [],
  );

  const handleSubtitleCueRangeChange = useCallback(
    (updates: readonly SubtitleCueRangeUpdate[], duration: number) => {
      setEditableSubtitleCues((currentCues) =>
        updateEditableSubtitleCueRanges(currentCues, updates, duration),
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
    subtitleCues: editableSubtitleCues,
    subtitleLoading,
    subtitleError,
    subtitlePreviewEnabled,
    selectedSubtitleCue,
    selectedSubtitleCueId,
    clippedSubtitleCues,
    subtitleExportSummary,
    handleSelectedSubtitleTrackChange,
    handleSubtitleCueSelect,
    handleSubtitleCueTextChange,
    handleSubtitleCueRangeChange,
  };
}
