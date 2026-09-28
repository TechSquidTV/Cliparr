import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fromSeconds,
  toSeconds,
  useTimelineClips,
  useTimelinePlayheadTime,
  useTimelineSelection,
  useTimelineTracks,
  type TimelineEngine,
} from "@techsquidtv/canvas-timeline";
import type { EditorDraft } from "@/components/editor/editorDrafts";
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
import { normalizeSubtitleCueText } from "@/lib/subtitles/normalizeSubtitleCueText";
import type { PlaybackSubtitleTrack } from "@/providers/types";
import { buildSubtitleExportSummary } from "@/components/editor/subtitleExportSummary";
import { useSubtitleCues } from "@/components/editor/useSubtitleCues";
import { useEditorHistory } from "@/components/editor/useEditorHistory";
import {
  createSubtitleClip,
  getSubtitleCreationRange,
  EDITOR_SUBTITLE_TRACK_ID,
  subtitleCueFromTimelineClip,
  subtitleCuesFromTimeline,
  synchronizeEditorTimelineSubtitles,
  timelineScrollLeftForCenteredTime,
} from "@/components/editor/editorTimelineEngine";

interface UseEditorSubtitlesProperties {
  initialDraft?: EditorDraft | null;
  engine: TimelineEngine;
  session: EditorSession;
  startTime: number;
  endTime: number;
  duration: number;
  mediaReady: boolean;
  pausePlayback: () => void;
  onSubtitleCreated: () => void;
}

interface SubtitleTextEdit {
  clipId: string;
  text: string;
}

export function useEditorSubtitles({
  initialDraft,
  engine,
  session,
  startTime,
  endTime,
  duration,
  mediaReady,
  pausePlayback,
  onSubtitleCreated,
}: UseEditorSubtitlesProperties) {
  const { tracks } = useTimelineTracks();
  const { clips } = useTimelineClips();
  const playheadTime = useTimelinePlayheadTime();
  const { selectedClip, selectedClipTrackId, selectClip } =
    useTimelineSelection();
  const [subtitleStyleSettings, setSubtitleStyleSettings] = useState(
    loadSubtitleStyleSettings,
  );
  const subtitleTracks = useMemo<PlaybackSubtitleTrack[]>(
    () =>
      session.local
        ? []
        : (session.subtitleTracks ?? []).filter(subtitleTrackSupportsBurnIn),
    [session.local, session.subtitleTracks],
  );
  const [initialized, setInitialized] = useState(Boolean(initialDraft));
  const initialImportStarted = useRef(Boolean(initialDraft));
  const [importTrack, setImportTrack] = useState<PlaybackSubtitleTrack | null>(
    null,
  );
  const [pendingImport, setPendingImport] =
    useState<PlaybackSubtitleTrack | null>(null);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [clearPending, setClearPending] = useState(false);
  const [textEdit, setTextEdit] = useState<SubtitleTextEdit | null>(null);
  const textEditReference = useRef<SubtitleTextEdit | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const history = useEditorHistory(engine, mediaReady && initialized);
  const { runAction } = history;
  const download = useSubtitleCues({
    selectedSubtitleTrack: importTrack,
    subtitleEnabled: importTrack !== null,
    providerId: session.source.providerId,
  });
  const { resetSubtitleCues } = download;
  const subtitleLoading = importTrack !== null;

  useEffect(() => {
    saveSubtitleStyleSettings(subtitleStyleSettings);
  }, [subtitleStyleSettings]);
  useEffect(() => {
    if (!mediaReady || duration <= 0 || initialImportStarted.current) {
      return;
    }
    initialImportStarted.current = true;
    const track = selectPreferredSubtitleTrack(
      subtitleTracks,
      session.selectedSubtitleTrack,
    );
    if (track) {
      setImportTrack(track);
    } else {
      setInitialized(true);
    }
  }, [duration, mediaReady, session.selectedSubtitleTrack, subtitleTracks]);

  useEffect(() => {
    if (!importTrack || !mediaReady) {
      return;
    }
    if (download.subtitleError) {
      setSubtitleError(download.subtitleError);
      setImportTrack(null);
      resetSubtitleCues();
      setInitialized(true);
    } else if (
      download.loadedSubtitleTrackKey === subtitleTrackKey(importTrack)
    ) {
      runAction(() => {
        synchronizeEditorTimelineSubtitles(engine, {
          // Provider identifiers are not editor identities.
          cues: download.subtitleCues.map((cue) => ({
            ...cue,
            id: crypto.randomUUID(),
          })),
        });
      });
      selectClip(null);
      setImportTrack(null);
      resetSubtitleCues();
      setInitialized(true);
    }
  }, [
    download.loadedSubtitleTrackKey,
    download.subtitleCues,
    download.subtitleError,
    engine,
    importTrack,
    mediaReady,
    resetSubtitleCues,
    runAction,
    selectClip,
  ]);

  const commitText = useCallback(() => {
    const edit = textEditReference.current;
    if (!edit) {
      return;
    }
    textEditReference.current = null;
    setTextEdit(null);
    const normalized = normalizeSubtitleCueText(edit.text);
    if (!normalized) {
      setTextError("Enter subtitle text, or use Delete subtitle to remove it.");
      return;
    }
    const clip = engine.geometry.getClip(edit.clipId)?.clip;
    if (clip && clip.label !== normalized.text) {
      engine.updateClipProperties(edit.clipId, { label: normalized.text });
    }
  }, [engine]);

  // Authoring actions finish text before changing the document; the timeline captures native interactions before its commands run.
  // This subscription covers engine API selection changes. Blur, explicit text commits, and export finish editing at their UI boundaries.
  useEffect(
    () =>
      engine.on("clip:select", () => {
        commitText();
        setTextError(null);
      }),
    [commitText, engine],
  );

  const timelineSubtitleCues = useMemo(
    () => subtitleCuesFromTimeline(tracks),
    [tracks],
  );
  const subtitleCues = useMemo(() => {
    const normalized = textEdit && normalizeSubtitleCueText(textEdit.text);
    return normalized
      ? timelineSubtitleCues.map((cue) =>
          cue.id === textEdit?.clipId ? { ...cue, ...normalized } : cue,
        )
      : timelineSubtitleCues;
  }, [textEdit, timelineSubtitleCues]);
  const subtitleClipEntries = useMemo(
    () =>
      clips
        .filter((entry) => entry.track.id === EDITOR_SUBTITLE_TRACK_ID)
        .toSorted(
          (a, b) =>
            toSeconds(a.clip.timelineStart) - toSeconds(b.clip.timelineStart),
        ),
    [clips],
  );
  const selectedSubtitleClip =
    selectedClipTrackId === EDITOR_SUBTITLE_TRACK_ID ? selectedClip : null;
  const selectedSubtitleCue = selectedSubtitleClip
    ? subtitleCueFromTimelineClip(selectedSubtitleClip)
    : null;
  const subtitleOutputEnabled =
    tracks.find((track) => track.id === EDITOR_SUBTITLE_TRACK_ID)?.visible ??
    true;
  const clippedSubtitleCues = useMemo(
    () =>
      subtitleOutputEnabled
        ? trimSubtitleCues(subtitleCues, startTime, endTime)
        : [],
    [endTime, startTime, subtitleCues, subtitleOutputEnabled],
  );
  const subtitleExportSummary = buildSubtitleExportSummary({
    subtitleEnabled: subtitleOutputEnabled,
    clippedSubtitleCueCount: clippedSubtitleCues.length,
    subtitleLoading,
  });
  const canEditSubtitles = mediaReady && initialized && !subtitleLoading;
  const canAddSubtitle =
    canEditSubtitles &&
    getSubtitleCreationRange(tracks, toSeconds(playheadTime), duration) !==
      null;

  function cancelImport() {
    setImportTrack(null);
    resetSubtitleCues();
    setInitialized(true);
  }
  function beginImport(track: PlaybackSubtitleTrack) {
    commitText();
    resetSubtitleCues();
    setSubtitleError(null);
    setPendingImport(null);
    setImportTrack(track);
  }
  function requestImport(key: string) {
    if (!canEditSubtitles) {
      return;
    }
    const track = subtitleTracks.find(
      (candidate) => subtitleTrackKey(candidate) === key,
    );
    if (!track) {
      return;
    }
    if (subtitleCues.length > 0) {
      commitText();
      setPendingImport(track);
    } else {
      beginImport(track);
    }
  }
  function addSubtitle() {
    if (!canEditSubtitles) {
      return;
    }
    pausePlayback();
    // Recheck live state: playback may have advanced since the button rendered.
    const state = engine.getState();
    const time = toSeconds(state.playheadTime);
    const range = getSubtitleCreationRange(state.tracks, time, duration);
    if (!range) {
      return;
    }
    commitText();
    const clip = createSubtitleClip(
      {
        ...range,
        text: "New subtitle",
      },
      duration,
    );
    if (!clip) {
      return;
    }
    runAction(() => {
      // The permitted span is empty; native overwrite preserves all other cues.
      const result = engine.commitEdit({
        type: "overwrite",
        targetTrackId: EDITOR_SUBTITLE_TRACK_ID,
        startTime: fromSeconds(time),
        clip,
        snap: false,
      });
      if (!result.preview.valid) {
        setSubtitleError(
          result.preview.message ?? "Could not add a subtitle at this time.",
        );
        return;
      }
      if (!subtitleOutputEnabled) {
        engine.toggleTrackVisibility(EDITOR_SUBTITLE_TRACK_ID, true);
      }
      selectClip(clip.id);
      engine.setScrollLeft(
        timelineScrollLeftForCenteredTime({
          maxScrollLeft: engine.maxScrollLeft,
          timeSeconds: time,
          viewportWidth: engine.getState().viewportWidth ?? 0,
          zoomScale: engine.getState().zoomScale,
        }),
      );
      setTextError(null);
      onSubtitleCreated();
      setFocusRevision((value) => value + 1);
    });
  }
  function deleteSubtitle() {
    if (!selectedSubtitleClip || subtitleLoading) {
      return;
    }
    commitText();
    const index = subtitleClipEntries.findIndex(
      (entry) => entry.clip.id === selectedSubtitleClip.id,
    );
    engine.commitEdit({
      type: "delete-clips",
      clipIds: [selectedSubtitleClip.id],
    });
    selectClip(
      (subtitleClipEntries[index + 1] ?? subtitleClipEntries[index - 1])?.clip
        .id ?? null,
    );
    setTextError(null);
  }
  function clearSubtitles() {
    commitText();
    cancelImport();
    initialImportStarted.current = true;
    engine.commitEdit({
      type: "delete-clips",
      clipIds: subtitleClipEntries.map((entry) => entry.clip.id),
    });
    selectClip(null);
    setClearPending(false);
    setSubtitleError(null);
    setTextError(null);
  }
  function trimSubtitle(edge: "start" | "end", time: number) {
    if (!selectedSubtitleClip || subtitleLoading || !Number.isFinite(time)) {
      return;
    }
    commitText();
    engine.commitEdit({
      type: "trim",
      clipId: selectedSubtitleClip.id,
      edge,
      // eslint-disable-next-line unicorn/no-keyword-prefix -- Canvas Timeline command field.
      newTime: fromSeconds(Math.min(Math.max(0, time), duration)),
      snap: false,
    });
  }
  function selectRelative(offset: -1 | 1) {
    commitText();
    const index = subtitleClipEntries.findIndex(
      (entry) => entry.clip.id === selectedSubtitleClip?.id,
    );
    selectClip(
      subtitleClipEntries[
        Math.min(Math.max(index + offset, 0), subtitleClipEntries.length - 1)
      ]?.clip.id ?? null,
    );
    setTextError(null);
  }

  return {
    history: {
      ...history,
      canUndo: !subtitleLoading && history.canUndo,
      canRedo: !subtitleLoading && history.canRedo,
      undo: () => {
        if (!subtitleLoading) {
          commitText();
          history.undo();
        }
      },
      redo: () => {
        if (!subtitleLoading) {
          commitText();
          history.redo();
        }
      },
    },
    initialized,
    subtitleTracks,
    subtitleOutputEnabled,
    setSubtitleEnabled: (visible: boolean) => {
      commitText();
      engine.toggleTrackVisibility(EDITOR_SUBTITLE_TRACK_ID, visible);
    },
    subtitleStyleSettings,
    setSubtitleStyleSettings,
    subtitleCues,
    subtitleLoading,
    subtitleError,
    clippedSubtitleCues,
    subtitleExportSummary,
    requestImport,
    cancelImport,
    subtitleTrackChangePending: pendingImport !== null,
    confirmSubtitleTrackChange: () => {
      if (pendingImport) {
        beginImport(pendingImport);
      }
    },
    cancelSubtitleTrackChange: () => setPendingImport(null),
    clearPending,
    requestClear: () => {
      commitText();
      setClearPending(true);
    },
    confirmClear: clearSubtitles,
    cancelClear: () => setClearPending(false),
    canImportSubtitles: canEditSubtitles && subtitleTracks.length > 0,
    canAddSubtitle,
    addSubtitle,
    focusRevision,
    selectedSubtitleCue,
    selectedSubtitleOutsideRange: Boolean(
      selectedSubtitleCue &&
      (selectedSubtitleCue.endTime <= startTime ||
        selectedSubtitleCue.startTime >= endTime),
    ),
    subtitleText:
      textEdit?.clipId === selectedSubtitleClip?.id
        ? (textEdit?.text ?? "")
        : (selectedSubtitleCue?.text ?? ""),
    textError,
    editSubtitleText: (text: string) => {
      if (!selectedSubtitleClip || subtitleLoading) {
        return;
      }
      const edit = { clipId: selectedSubtitleClip.id, text };
      textEditReference.current = edit;
      setTextEdit(edit);
      setTextError(null);
    },
    commitText,
    handleSelectedSubtitleStartCommit: (time: number) =>
      trimSubtitle("start", time),
    handleSelectedSubtitleEndCommit: (time: number) =>
      trimSubtitle("end", time),
    handleDeleteSelectedSubtitle: deleteSubtitle,
    handleSelectPreviousSubtitle: () => selectRelative(-1),
    handleSelectNextSubtitle: () => selectRelative(1),
    handleSeekToSelectedSubtitle: () => {
      if (selectedSubtitleCue) {
        commitText();
        pausePlayback();
        engine.updatePlayhead(fromSeconds(selectedSubtitleCue.startTime));
      }
    },
  };
}
