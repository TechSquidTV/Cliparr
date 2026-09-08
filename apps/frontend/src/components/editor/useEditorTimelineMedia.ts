import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fromSeconds,
  toSeconds,
  useTimelinePlayheadTime,
  type TimelineEngine,
  type TimelineMediaError,
} from "@techsquidtv/canvas-timeline";
import type {
  MediabunnySource,
  MediabunnySourceInput,
  MediabunnyTrackSelection,
  MediabunnyTrackSelectionContext,
} from "@techsquidtv/canvas-timeline-mediabunny-adapter";
import {
  useMediabunnyFrameTime,
  useMediabunnyTimelineMedia,
} from "@techsquidtv/canvas-timeline-mediabunny-adapter/react";
import type { Input, InputTrack, InputVideoTrack } from "mediabunny";
import {
  assessPreviewAudioTrack,
  buildPlaybackSourceCandidates,
  formatPlaybackSourceLabel,
  isPresent,
  playbackAudioSelectionsEqual,
  playbackSourceCandidatesEqual,
  resolvePlaybackDuration,
  selectPreviewVideoTrack,
  type PlaybackFallbackInfo,
  type PlaybackSourceCandidate,
} from "@/components/editor/editorPlaybackSources";
import {
  DEFAULT_EDITOR_FRAME_STEP_SECONDS,
  frameStepSecondsFromFrameRate,
} from "@/components/editor/editorShortcutCommands";
import {
  EDITOR_MEDIA_SOURCE_ID,
  synchronizeEditorTimelineMedia,
} from "@/components/editor/editorTimelineEngine";
import { errorMessage } from "@/components/editor/editorUtilities";
import {
  editorMediaSourcesEqual,
  type EditorMediaSource,
  type EditorSession,
  type MediaDimensions,
} from "@/lib/editorMedia";
import { ensureMediabunnyCodecs } from "@/lib/mediabunnyCodecs";
import { createCliparrInputFromSource } from "@/lib/mediabunnyInput";
import {
  fromSourceTimelineTime,
  getTrackTimelineOffsetSeconds,
  isPlaybackVideoTrack,
  getVideoTrackDimensions,
} from "@/lib/mediabunnyTrackAccess";
import { selectPreferredPairableAudioTrack } from "@/lib/selectPreferredAudioTrack";
import {
  createEditorPreviewSourceLoader,
  editorPreviewFrameTime,
  resolveEditorExportMedia,
  type EditorExportMedia,
  type EditorMediaMetadata,
} from "@/components/editor/editorMediaLifecycle";

const previewLayerSelectors = {
  visuals: { trackKind: "media", sourceId: EDITOR_MEDIA_SOURCE_ID },
  audio: { trackKind: "media", sourceId: EDITOR_MEDIA_SOURCE_ID },
} as const;
const mediaTrackKinds = ["media"] as const;
const previewPlaybackOptions = { respectInOut: true, loop: false } as const;

interface LoadedMediaDetails {
  configurationId: symbol | null;
  exportMedia: EditorExportMedia | null;
  activeSourceLabel: string;
  exportFallbackSource?: EditorMediaSource;
  frameStepSeconds: number;
  hlsFallbackInfo: PlaybackFallbackInfo | null;
  previewVideoDimensions: MediaDimensions | null;
  timelineOffsetSeconds: number;
}

const initialMediaDetails: LoadedMediaDetails = {
  configurationId: null,
  exportMedia: null,
  activeSourceLabel: "",
  frameStepSeconds: DEFAULT_EDITOR_FRAME_STEP_SECONDS,
  hlsFallbackInfo: null,
  previewVideoDimensions: null,
  timelineOffsetSeconds: 0,
};

async function detectFrameStepSeconds(
  sourceVideoTrack: InputVideoTrack | null,
) {
  if (!sourceVideoTrack) {
    return DEFAULT_EDITOR_FRAME_STEP_SECONDS;
  }

  const stats = await sourceVideoTrack.computePacketStats(120, {
    skipLiveWait: true,
  });
  return frameStepSecondsFromFrameRate(stats.averagePacketRate);
}

async function prepareInput(
  input: Input,
  candidate: PlaybackSourceCandidate,
  session: EditorSession,
): Promise<EditorMediaMetadata & MediabunnyTrackSelection> {
  const videoTracks = await input.getVideoTracks({
    filter: isPlaybackVideoTrack,
  });
  const { sourceVideoTrack, previewVideoTrack } =
    await selectPreviewVideoTrack(videoTracks);
  const audioTracks = await input.getAudioTracks();
  const sourceAudioTrack = await selectPreferredPairableAudioTrack(
    sourceVideoTrack,
    audioTracks,
    session.selectedAudioTrack,
  );
  const selectedPreviewAudioTrack = await selectPreferredPairableAudioTrack(
    previewVideoTrack,
    audioTracks,
    session.selectedAudioTrack,
  );
  const previewAudioAssessment = await assessPreviewAudioTrack(
    selectedPreviewAudioTrack,
  );
  const previewAudioTrack = previewAudioAssessment.track;

  if (!previewVideoTrack && !previewAudioTrack) {
    throw new Error("No browser-decodable audio or video track was found.");
  }

  const sourceTracks: InputTrack[] = [
    sourceVideoTrack,
    sourceAudioTrack,
  ].filter(isPresent);
  const durationTracks =
    sourceTracks.length > 0
      ? sourceTracks
      : [previewVideoTrack, previewAudioTrack].filter(isPresent);
  const timelineOffsetSeconds =
    await getTrackTimelineOffsetSeconds(durationTracks);
  const sourceTimelineEnd =
    (await input.getDurationFromMetadata(durationTracks, {
      skipLiveWait: true,
    })) ??
    (await input.computeDuration(durationTracks, { skipLiveWait: true }));
  const duration = resolvePlaybackDuration(
    candidate,
    fromSourceTimelineTime(sourceTimelineEnd, timelineOffsetSeconds),
    session.duration,
  );
  const [sourceVideoDimensions, previewVideoDimensions, frameStepSeconds] =
    await Promise.all([
      sourceVideoTrack
        ? getVideoTrackDimensions(sourceVideoTrack)
        : Promise.resolve(null),
      previewVideoTrack
        ? getVideoTrackDimensions(previewVideoTrack)
        : Promise.resolve(null),
      detectFrameStepSeconds(sourceVideoTrack).catch(
        () => DEFAULT_EDITOR_FRAME_STEP_SECONDS,
      ),
    ]);

  return {
    videoTrack: previewVideoTrack,
    audioTrack: previewAudioTrack,
    duration,
    frameStepSeconds,
    previewVideoDimensions,
    sourceVideoDimensions,
    timelineOffsetSeconds,
  };
}

export function useEditorTimelineMedia(
  session: EditorSession,
  engine: TimelineEngine,
) {
  const playheadTime = useTimelinePlayheadTime();
  const [details, setDetails] =
    useState<LoadedMediaDetails>(initialMediaDetails);
  const [playbackError, setPlaybackError] = useState("");
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const sessionReference = useRef(session);
  sessionReference.current = session;

  const nextCandidates = buildPlaybackSourceCandidates(
    session.hlsSource,
    session.directSource,
  );
  const candidatesReference = useRef(nextCandidates);
  if (
    !playbackSourceCandidatesEqual(candidatesReference.current, nextCandidates)
  ) {
    candidatesReference.current = nextCandidates;
  }
  const candidates = candidatesReference.current;
  const selectedAudioTrackReference = useRef(session.selectedAudioTrack);
  if (
    !playbackAudioSelectionsEqual(
      selectedAudioTrackReference.current,
      session.selectedAudioTrack,
    )
  ) {
    selectedAudioTrackReference.current = session.selectedAudioTrack;
  }
  const selectedAudioTrack = selectedAudioTrackReference.current;

  const mediaSource = useMemo(() => {
    const preparedInputs = new Map<number, EditorMediaMetadata>();
    const inputs = candidates.map<MediabunnySourceInput>((candidate) => ({
      kind: "input-factory",
      createInput: async () => {
        await ensureMediabunnyCodecs();
        return createCliparrInputFromSource(candidate.source, {
          hls:
            candidate.label === "hls stream" || candidate.label === "hls url",
        });
      },
    }));
    const selectTracks = async ({
      input,
      sourceInput,
    }: MediabunnyTrackSelectionContext) => {
      const inputIndex = inputs.indexOf(sourceInput);
      const candidate = candidates[inputIndex];
      if (!candidate) {
        throw new Error("The preview source is no longer available.");
      }
      const prepared = await prepareInput(input, candidate, {
        ...sessionReference.current,
        selectedAudioTrack,
      });
      const { videoTrack, audioTrack, ...metadata } = prepared;
      preparedInputs.set(inputIndex, metadata);
      return {
        videoTrack,
        audioTrack,
      };
    };
    const [input, ...fallbacks] = inputs;
    // These delivery candidates all represent the same Cliparr media item.
    const sources: readonly MediabunnySource[] = input
      ? [{ sourceId: EDITOR_MEDIA_SOURCE_ID, input, fallbacks }]
      : [];
    return { configurationId: Symbol(), sources, selectTracks, preparedInputs };
  }, [candidates, selectedAudioTrack]);
  const handleMediaError = useCallback((error: TimelineMediaError) => {
    setPlaybackError(error.message);
  }, []);
  const media = useMediabunnyTimelineMedia({
    sources: mediaSource.sources,
    selectTracks: mediaSource.selectTracks,
    audio: { muted, volume },
    audioTrackKinds: mediaTrackKinds,
    visualTrackKinds: mediaTrackKinds,
    layers: previewLayerSelectors,
    onError: handleMediaError,
    playbackOptions: previewPlaybackOptions,
  });
  const { adapter, pause, play, playing, canvasRef: mediaCanvasRef } = media;
  const previewRequest = useRef(0);
  const loadPreviewSource = useMemo(
    () => createEditorPreviewSourceLoader(adapter, EDITOR_MEDIA_SOURCE_ID),
    [adapter],
  );
  useEffect(() => {
    let cancelled = false;
    if (adapter.ready) {
      void loadPreviewSource().catch((error: Error) => {
        if (!cancelled) {
          setPlaybackError(errorMessage(error));
        }
      });
    }
    return () => {
      cancelled = true;
      previewRequest.current += 1;
    };
  }, [adapter, loadPreviewSource]);
  const renderedFrameTime = useMediabunnyFrameTime(adapter);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const connectCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      canvasRef.current = canvas;
      mediaCanvasRef(canvas);
    },
    [mediaCanvasRef],
  );
  const sourceState = media.sourceStateById.get(EDITOR_MEDIA_SOURCE_ID);
  const preparedInput =
    sourceState?.status === "ready" && sourceState.selectedInputIndex !== null
      ? mediaSource.preparedInputs.get(sourceState.selectedInputIndex)
      : undefined;
  const exportMedia = resolveEditorExportMedia(
    details.configurationId === mediaSource.configurationId
      ? details.exportMedia
      : null,
    sourceState,
    candidates,
    mediaSource.preparedInputs,
  );
  const synchronizedInputReference = useRef<EditorMediaMetadata | null>(null);
  const synchronizationInput =
    preparedInput ??
    (details.configurationId === mediaSource.configurationId
      ? synchronizedInputReference.current
      : exportMedia?.metadata);

  useEffect(() => {
    if (
      !exportMedia ||
      !synchronizationInput ||
      synchronizedInputReference.current === synchronizationInput
    ) {
      return;
    }
    const candidate =
      candidates[sourceState?.selectedInputIndex ?? -1] ??
      exportMedia.candidate;
    const currentSession = sessionReference.current;
    const usingDirectFallback = Boolean(
      currentSession.hlsSource &&
      currentSession.directSource &&
      editorMediaSourcesEqual(candidate.source, currentSession.directSource),
    );
    synchronizeEditorTimelineMedia(engine, {
      duration: exportMedia.metadata.duration,
      sourceStart: synchronizationInput.timelineOffsetSeconds,
      initialDuration:
        synchronizedInputReference.current?.duration ?? currentSession.duration,
      initialPlayheadSeconds: currentSession.initialPlayheadSeconds,
    });
    synchronizedInputReference.current = synchronizationInput;
    setDetails({
      configurationId: mediaSource.configurationId,
      exportMedia,
      activeSourceLabel: formatPlaybackSourceLabel(candidate.label),
      exportFallbackSource:
        currentSession.hlsSource &&
        currentSession.directSource &&
        editorMediaSourcesEqual(
          exportMedia.candidate.source,
          currentSession.directSource,
        )
          ? exportMedia.candidate.source
          : undefined,
      frameStepSeconds: synchronizationInput.frameStepSeconds,
      hlsFallbackInfo: usingDirectFallback
        ? {
            message:
              sourceState?.attempts.find((attempt) => attempt.error)?.error
                ?.message ??
              "The HLS preview source could not be loaded by the timeline media adapter.",
          }
        : null,
      previewVideoDimensions: synchronizationInput.previewVideoDimensions,
      timelineOffsetSeconds: synchronizationInput.timelineOffsetSeconds,
    });
    setPlaybackError("");
  }, [
    candidates,
    engine,
    exportMedia,
    mediaSource.configurationId,
    sourceState,
    synchronizationInput,
  ]);
  const duration = toSeconds(
    engine.getState().duration ?? fromSeconds(session.duration),
  );
  const renderedTimelineFrameTime = editorPreviewFrameTime(
    renderedFrameTime,
    details.timelineOffsetSeconds,
    duration,
  );

  const pausePlayback = useCallback(() => {
    previewRequest.current += 1;
    pause();
  }, [pause]);
  const ensurePreview = useCallback(
    async (request: number) => {
      try {
        const result = await loadPreviewSource();
        if (previewRequest.current !== request) {
          return false;
        }
        setPlaybackError(result.ok ? "" : result.error.message);
        return result.ok;
      } catch (error) {
        if (previewRequest.current === request) {
          setPlaybackError(errorMessage(error));
        }
        return false;
      }
    },
    [loadPreviewSource],
  );
  const seekToTime = useCallback(
    (seconds: number) => {
      pausePlayback();
      engine.updatePlayhead(fromSeconds(seconds));
      if (
        adapter.sourceStateById.get(EDITOR_MEDIA_SOURCE_ID)?.status !== "ready"
      ) {
        void ensurePreview(previewRequest.current);
      }
    },
    [adapter, engine, ensurePreview, pausePlayback],
  );
  const togglePlay = useCallback(async () => {
    if (playing) {
      pausePlayback();
      setPlaybackError("");
      return;
    }

    const request = ++previewRequest.current;
    const state = engine.getState();
    const currentSeconds = toSeconds(engine.getTime());
    const inPointSeconds = state.inPoint ? toSeconds(state.inPoint) : 0;
    const outPointSeconds = state.outPoint
      ? toSeconds(state.outPoint)
      : Number.POSITIVE_INFINITY;
    if (currentSeconds < inPointSeconds || currentSeconds >= outPointSeconds) {
      engine.updatePlayhead(state.inPoint ?? fromSeconds(0));
    }

    if (
      adapter.sourceStateById.get(EDITOR_MEDIA_SOURCE_ID)?.status !== "ready"
    ) {
      // Preserve user activation while an explicit retry reopens the input.
      adapter.requestClockActivation(state.playbackRate ?? 1);
      if (!(await ensurePreview(request))) {
        return;
      }
    }
    const result = await play();
    if (previewRequest.current !== request) {
      return;
    }
    setPlaybackError(
      result.ok || result.reason === "cancelled" ? "" : result.message,
    );
  }, [adapter, engine, ensurePreview, pausePlayback, play, playing]);
  const getPlaybackTime = useCallback(
    () => (playing ? adapter.getClockTime() : toSeconds(engine.getTime())),
    [adapter, engine, playing],
  );

  const sourceReady = preparedInput !== undefined;
  const loadingPreview =
    !sourceReady &&
    (sourceState?.status === "loading" ||
      sourceState?.status === "recovering" ||
      !media.error);
  const loadingPreviewFrame =
    sourceReady &&
    details.previewVideoDimensions !== null &&
    renderedTimelineFrameTime === null;
  const previewError = playbackError || media.error?.message || "";

  return {
    canvasRef,
    connectCanvas,
    currentTime: toSeconds(playheadTime),
    renderedFrameTime: renderedTimelineFrameTime,
    duration,
    playing,
    loadingPreview,
    loadingPreviewFrame,
    previewStatus: media.status,
    previewFrameStatus: "Loading preview frame...",
    error:
      (sourceState?.status === "failed"
        ? `${previewError} Press Play or seek to retry the preview.`
        : previewError) ||
      (adapter.audioStatus.state === "degraded"
        ? `Audio preview is unavailable. Video playback will continue without audio${adapter.audioStatus.error ? `: ${errorMessage(adapter.audioStatus.error)}` : "."}`
        : ""),
    activeSourceLabel: details.activeSourceLabel,
    exportFallbackSource: details.exportFallbackSource,
    hlsFallbackInfo: details.hlsFallbackInfo,
    sourceVideoDimensions: exportMedia?.metadata.sourceVideoDimensions ?? null,
    previewVideoDimensions: details.previewVideoDimensions,
    frameStepSeconds: details.frameStepSeconds,
    volume,
    muted,
    setVolume,
    setMuted,
    togglePlay,
    pausePlayback,
    seekToTime,
    getPlaybackTime,
    metadataReady: exportMedia !== null,
  };
}
