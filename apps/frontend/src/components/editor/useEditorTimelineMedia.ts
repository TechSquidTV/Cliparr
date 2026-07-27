import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fromSeconds,
  toSeconds,
  useTimeline,
  useTimelineEvent,
  useTimelineMediaSync,
  useTimelinePlayheadTime,
} from "@techsquidtv/canvas-timeline";
import type {
  MediabunnyModule,
  MediabunnySource,
} from "@techsquidtv/canvas-timeline-mediabunny-adapter";
import type {
  Input,
  InputAudioTrack,
  InputTrack,
  InputVideoTrack,
} from "mediabunny";
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
import { useEditorMediabunnyAdapter } from "@/components/editor/useEditorMediabunnyAdapter";
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
  getVideoTrackDimensions,
} from "@/lib/mediabunnyTrackAccess";
import { selectPreferredPairableAudioTrack } from "@/lib/selectPreferredAudioTrack";

const previewLayerSelectors = {
  visuals: { trackKind: "media", sourceId: EDITOR_MEDIA_SOURCE_ID },
  audio: { trackKind: "media", sourceId: EDITOR_MEDIA_SOURCE_ID },
} as const;

interface LoadedMediaDetails {
  activeSourceLabel: string;
  exportFallbackSource?: EditorMediaSource;
  frameStepSeconds: number;
  hlsFallbackInfo: PlaybackFallbackInfo | null;
  previewVideoDimensions: MediaDimensions | null;
  sourceVideoDimensions: MediaDimensions | null;
  timelineOffsetSeconds: number;
}

interface PreparedInput {
  input: Input;
  duration: number;
  frameStepSeconds: number;
  previewVideoDimensions: MediaDimensions | null;
  sourceVideoDimensions: MediaDimensions | null;
  timelineOffsetSeconds: number;
}

const initialMediaDetails: LoadedMediaDetails = {
  activeSourceLabel: "",
  frameStepSeconds: DEFAULT_EDITOR_FRAME_STEP_SECONDS,
  hlsFallbackInfo: null,
  previewVideoDimensions: null,
  sourceVideoDimensions: null,
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

function overridePrimaryTracks(
  input: Input,
  videoTrack: InputVideoTrack | null,
  audioTrack: InputAudioTrack | null,
) {
  Object.defineProperties(input, {
    getPrimaryVideoTrack: {
      configurable: true,
      value: () => Promise.resolve(videoTrack),
    },
    getPrimaryAudioTrack: {
      configurable: true,
      value: () => Promise.resolve(audioTrack),
    },
  });
}

async function prepareInput(
  input: Input,
  candidate: PlaybackSourceCandidate,
  session: EditorSession,
): Promise<PreparedInput> {
  const videoTracks = await input.getVideoTracks({
    filter: async (track) => !(await track.hasOnlyKeyPackets()),
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

  overridePrimaryTracks(input, previewVideoTrack, previewAudioTrack);

  return {
    input,
    duration,
    frameStepSeconds,
    previewVideoDimensions,
    sourceVideoDimensions,
    timelineOffsetSeconds,
  };
}

export function useEditorTimelineMedia(session: EditorSession) {
  const { engine } = useTimeline();
  const playheadTime = useTimelinePlayheadTime();
  const [details, setDetails] =
    useState<LoadedMediaDetails>(initialMediaDetails);
  const [playbackError, setPlaybackError] = useState("");
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const sessionReference = useRef(session);
  const hlsFailureMessageReference = useRef<string | null>(null);
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

  const sources = useMemo<readonly MediabunnySource[]>(
    () =>
      candidates.map((candidate) => ({
        id: EDITOR_MEDIA_SOURCE_ID,
        createInput: async (_mediabunny: MediabunnyModule) => {
          await ensureMediabunnyCodecs();
          const input = await createCliparrInputFromSource(candidate.source, {
            hls:
              candidate.label === "hls stream" || candidate.label === "hls url",
          });

          try {
            const currentSession = {
              ...sessionReference.current,
              selectedAudioTrack,
            };
            const prepared = await prepareInput(
              input,
              candidate,
              currentSession,
            );
            const usingDirectFallback = Boolean(
              currentSession.hlsSource &&
              currentSession.directSource &&
              editorMediaSourcesEqual(
                candidate.source,
                currentSession.directSource,
              ),
            );
            synchronizeEditorTimelineMedia(engine, {
              duration: prepared.duration,
              sourceStart: prepared.timelineOffsetSeconds,
              initialDuration: currentSession.duration,
              initialPlayheadSeconds: currentSession.initialPlayheadSeconds,
            });
            setDetails({
              activeSourceLabel: formatPlaybackSourceLabel(candidate.label),
              exportFallbackSource: usingDirectFallback
                ? candidate.source
                : undefined,
              frameStepSeconds: prepared.frameStepSeconds,
              hlsFallbackInfo: usingDirectFallback
                ? {
                    message:
                      hlsFailureMessageReference.current ??
                      "The HLS preview source could not be loaded by the timeline media adapter.",
                  }
                : null,
              previewVideoDimensions: prepared.previewVideoDimensions,
              sourceVideoDimensions: prepared.sourceVideoDimensions,
              timelineOffsetSeconds: prepared.timelineOffsetSeconds,
            });
            return prepared.input;
          } catch (error) {
            input.dispose();
            if (
              candidate.label === "hls stream" ||
              candidate.label === "hls url"
            ) {
              hlsFailureMessageReference.current = errorMessage(error);
            }
            throw error;
          }
        },
      })),
    [candidates, engine, selectedAudioTrack],
  );
  const {
    adapter,
    audioResumeWarning,
    canvasRef,
    renderedFrameTime,
    syncAdapter,
  } = useEditorMediabunnyAdapter({ sources, muted, volume });
  const handleMediaError = useCallback((message: string) => {
    setPlaybackError(message);
  }, []);
  const { pause, play, playing } = useTimelineMediaSync({
    adapter: syncAdapter,
    layers: previewLayerSelectors,
    onError: handleMediaError,
    ready: adapter?.ready ?? false,
  });
  const renderedTimelineFrameTime =
    renderedFrameTime === null
      ? null
      : Math.max(
          0,
          fromSourceTimelineTime(
            renderedFrameTime,
            details.timelineOffsetSeconds,
          ),
        );

  useEffect(() => {
    if (adapter?.error) {
      setPlaybackError(adapter.error.message);
    }
  }, [adapter?.error]);

  useTimelineEvent("playhead:scrub", (time) => {
    const state = engine.getState();
    if (!state.playing || !state.outPoint) {
      return;
    }

    if (toSeconds(time) >= toSeconds(state.outPoint)) {
      pause();
      engine.updatePlayhead(state.inPoint ?? fromSeconds(0));
    }
  });

  const pausePlayback = useCallback(() => {
    pause();
  }, [pause]);
  const seekToTime = useCallback(
    (seconds: number) => {
      pause();
      engine.updatePlayhead(fromSeconds(seconds));
    },
    [engine, pause],
  );
  const togglePlay = useCallback(async () => {
    if (playing) {
      pause();
      setPlaybackError("");
      return;
    }

    const state = engine.getState();
    const currentSeconds = toSeconds(engine.getTime());
    const inPointSeconds = state.inPoint ? toSeconds(state.inPoint) : 0;
    const outPointSeconds = state.outPoint
      ? toSeconds(state.outPoint)
      : Number.POSITIVE_INFINITY;
    if (currentSeconds < inPointSeconds || currentSeconds >= outPointSeconds) {
      engine.updatePlayhead(state.inPoint ?? fromSeconds(0));
    }

    const result = await play();
    setPlaybackError(result.ok ? "" : result.message);
  }, [engine, pause, play, playing]);
  const getPlaybackTime = useCallback(
    () =>
      playing && adapter ? adapter.getClockTime() : toSeconds(engine.getTime()),
    [adapter, engine, playing],
  );

  const duration = toSeconds(
    engine.getState().duration ?? fromSeconds(session.duration),
  );
  const loadingPreview = !(adapter?.ready ?? false) && !adapter?.error;
  const loadingPreviewFrame =
    (adapter?.ready ?? false) &&
    details.previewVideoDimensions !== null &&
    renderedFrameTime === null;

  return {
    canvasRef,
    currentTime: toSeconds(playheadTime),
    renderedFrameTime: renderedTimelineFrameTime,
    duration,
    playing,
    loadingPreview,
    loadingPreviewFrame,
    previewStatus: adapter?.status ?? "Preparing media preview...",
    previewFrameStatus: "Loading preview frame...",
    error: playbackError || adapter?.error?.message || audioResumeWarning || "",
    activeSourceLabel: details.activeSourceLabel,
    exportFallbackSource: details.exportFallbackSource,
    hlsFallbackInfo: details.hlsFallbackInfo,
    sourceVideoDimensions: details.sourceVideoDimensions,
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
    ready: adapter?.ready ?? false,
  };
}
