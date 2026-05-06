import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AudioBufferSink,
  CanvasSink,
  Input,
  InputAudioTrack,
  InputTrack,
  InputVideoTrack,
  WrappedAudioBuffer,
  WrappedCanvas,
} from "mediabunny";
import { ensureMediabunnyCodecs } from "../../lib/mediabunnyCodecs";
import { createCliparrInputFromUrl, isHlsPlaylistUrl } from "../../lib/mediabunnyInput";
import {
  fromSourceTimelineTime,
  getAudioTrackSampleRate,
  getTrackCodec,
  getTrackTimelineOffsetSeconds,
  getVideoTrackDimensions,
  toSourceTimelineTime,
} from "../../lib/mediabunnyTrackAccess";
import { selectPreferredPairableAudioTrack } from "../../lib/selectPreferredAudioTrack";
import type { PlaybackAudioSelection } from "../../providers/types";
import { errorMessage, isAc3FamilyCodec, themeValue } from "./EditorUtils";

interface UseEditorPlaybackProps {
  hlsUrl?: string;
  mediaUrl?: string;
  initialDuration: number;
  startTime: number;
  endTime: number;
  sessionId: string;
  selectedAudioTrack?: PlaybackAudioSelection;
}

interface VideoDimensions {
  width: number;
  height: number;
}

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

interface PlaybackSourceCandidate {
  label: "hls stream" | "direct source";
  url: string;
}

interface PlaybackLoadFailure {
  label: PlaybackSourceCandidate["label"];
  message: string;
  classification: "hls-playlist" | "unknown";
  category: "open-or-read" | "preview-only" | "shared-export-blocking";
}

export interface PlaybackFallbackInfo {
  category: PlaybackLoadFailure["category"];
  message: string;
}

class PlaybackSourceError extends Error {
  category: PlaybackLoadFailure["category"];

  constructor(category: PlaybackLoadFailure["category"], message: string) {
    super(message);
    this.name = "PlaybackSourceError";
    this.category = category;
  }
}

function getAudioContextConstructor() {
  return window.AudioContext ?? (window as WindowWithWebkitAudioContext).webkitAudioContext;
}

function buildPlaybackSourceCandidates(hlsUrl: string | undefined, mediaUrl: string | undefined) {
  const candidates: PlaybackSourceCandidate[] = [];

  if (hlsUrl) {
    candidates.push({ label: "hls stream", url: hlsUrl });
  }

  if (mediaUrl && !candidates.some((candidate) => candidate.url === mediaUrl)) {
    candidates.push({ label: "direct source", url: mediaUrl });
  }

  return candidates;
}

function classifyPlaybackUrl(url: string): PlaybackLoadFailure["classification"] {
  return isHlsPlaylistUrl(url) ? "hls-playlist" : "unknown";
}

function buildPlaybackFailure(source: PlaybackSourceCandidate, err: unknown): PlaybackLoadFailure {
  return {
    label: source.label,
    message: errorMessage(err),
    classification: classifyPlaybackUrl(source.url),
    category: err instanceof PlaybackSourceError ? err.category : "open-or-read",
  };
}

function shouldUseExportFallback(failure: PlaybackLoadFailure) {
  return failure.category === "open-or-read" || failure.category === "shared-export-blocking";
}

function describePlaybackFailure(failure: PlaybackLoadFailure) {
  const prefix = failure.label === "hls stream" ? "HLS stream" : "Direct source";

  return `${prefix} failed: ${failure.message}`;
}

function formatPlaybackSourceLabel(label: PlaybackSourceCandidate["label"]) {
  return label === "hls stream" ? "HLS stream" : "Direct source";
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function buildPlaybackLoadError(failures: PlaybackLoadFailure[]) {
  if (failures.length === 0) {
    return "Playback could not be loaded.";
  }

  if (failures.length === 1) {
    return describePlaybackFailure(failures[0]);
  }

  return `Cliparr could not open any playback stream. ${failures.map(describePlaybackFailure).join(" ")}`;
}

async function assessPreviewVideoTrack(track: InputVideoTrack | null) {
  if (!track) {
    return { track: null, warning: undefined };
  }

  const videoCodec = await getTrackCodec(track);
  if (videoCodec === null) {
    return {
      track: null,
      warning: "Video codec is unknown.",
    };
  }

  if (!(await track.canDecode())) {
    return {
      track: null,
      warning: `Cannot decode ${videoCodec} video in this browser.`,
    };
  }

  return { track, warning: undefined };
}

async function selectPreviewVideoTrack(videoTracks: readonly InputVideoTrack[]) {
  const sourceVideoTrack = videoTracks[0] ?? null;
  if (!sourceVideoTrack) {
    return {
      sourceVideoTrack: null,
      previewVideoTrack: null,
      warnings: [] as string[],
    };
  }

  const warnings: string[] = [];
  const primaryAssessment = await assessPreviewVideoTrack(sourceVideoTrack);
  if (primaryAssessment.track) {
    return {
      sourceVideoTrack,
      previewVideoTrack: primaryAssessment.track,
      warnings,
    };
  }

  if (primaryAssessment.warning) {
    warnings.push(primaryAssessment.warning);
  }

  for (const candidate of videoTracks.slice(1)) {
    const candidateAssessment = await assessPreviewVideoTrack(candidate);
    if (candidateAssessment.track) {
      return {
        sourceVideoTrack,
        previewVideoTrack: candidateAssessment.track,
        warnings,
      };
    }
  }

  return {
    sourceVideoTrack,
    previewVideoTrack: null,
    warnings,
  };
}

async function assessPreviewAudioTrack(track: InputAudioTrack | null) {
  if (!track) {
    return { track: null, warning: undefined };
  }

  const audioCodec = await getTrackCodec(track);
  if (audioCodec === null) {
    return {
      track: null,
      warning: "Audio codec is unknown.",
    };
  }

  if (!(await track.canDecode()) && !isAc3FamilyCodec(audioCodec)) {
    return {
      track: null,
      warning: `Cannot decode ${audioCodec} audio in this browser.`,
    };
  }

  return { track, warning: undefined };
}

export function useEditorPlayback({
  hlsUrl,
  mediaUrl,
  initialDuration,
  startTime,
  endTime,
  sessionId,
  selectedAudioTrack,
}: UseEditorPlaybackProps) {
  const [duration, setDuration] = useState(() => Math.max(initialDuration, 0));
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewStatus, setPreviewStatus] = useState("Loading stream...");
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [activeSourceLabel, setActiveSourceLabel] = useState("");
  const [exportFallbackSourceUrl, setExportFallbackSourceUrl] = useState<string | undefined>(undefined);
  const [hlsFallbackInfo, setHlsFallbackInfo] = useState<PlaybackFallbackInfo | null>(null);
  const [sourceVideoDimensions, setSourceVideoDimensions] = useState<VideoDimensions | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<Input | null>(null);
  const videoSinkRef = useRef<CanvasSink | null>(null);
  const audioSinkRef = useRef<AudioBufferSink | null>(null);
  const videoFrameIteratorRef = useRef<AsyncGenerator<WrappedCanvas, void, unknown> | null>(null);
  const audioBufferIteratorRef = useRef<AsyncGenerator<WrappedAudioBuffer, void, unknown> | null>(null);
  const nextFrameRef = useRef<WrappedCanvas | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const queuedAudioNodesRef = useRef(new Set<AudioBufferSourceNode>());
  const animationFrameRef = useRef<number | null>(null);
  const renderIntervalRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const warmupGenerationRef = useRef(0);
  const warmupPromiseRef = useRef<Promise<void> | null>(null);
  const warmupTargetTimeRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const audioContextStartTimeRef = useRef<number | null>(null);
  const playbackTimeAtStartRef = useRef(0);
  const sourceTimelineOffsetRef = useRef(0);
  const skipLiveWaitRef = useRef(false);
  const activeSourceLabelRef = useRef(activeSourceLabel);
  
  const durationRef = useRef(duration);
  const startTimeRef = useRef(startTime);
  const endTimeRef = useRef(endTime);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    startTimeRef.current = startTime;
  }, [startTime]);

  useEffect(() => {
    endTimeRef.current = endTime;
  }, [endTime]);

  useEffect(() => {
    activeSourceLabelRef.current = activeSourceLabel;
  }, [activeSourceLabel]);

  useEffect(() => {
    volumeRef.current = volume;
    mutedRef.current = muted;
    if (gainNodeRef.current) {
      const actualVolume = muted || volume === 0 ? 0 : volume;
      gainNodeRef.current.gain.value = actualVolume ** 2;
    }
  }, [volume, muted]);

  const clampTime = useCallback((seconds: number) => {
    const maxDuration = durationRef.current;
    if (!Number.isFinite(maxDuration) || maxDuration <= 0) {
      return 0;
    }
    return Math.min(Math.max(seconds, 0), maxDuration);
  }, []);

  const getPlaybackTime = useCallback(() => {
    if (
      playingRef.current &&
      audioContextRef.current &&
      audioContextStartTimeRef.current !== null
    ) {
      return clampTime(
        audioContextRef.current.currentTime -
          audioContextStartTimeRef.current +
          playbackTimeAtStartRef.current
      );
    }
    return clampTime(playbackTimeAtStartRef.current);
  }, [clampTime]);

  const stopAudioNodes = useCallback(() => {
    for (const node of queuedAudioNodesRef.current) {
      try {
        node.stop();
      } catch {
        // The node may have already ended.
      }
    }
    queuedAudioNodesRef.current.clear();
  }, []);

  const pausePlayback = useCallback((storeCurrentTime = true) => {
    if (storeCurrentTime) {
      const nextTime = getPlaybackTime();
      playbackTimeAtStartRef.current = nextTime;
      setCurrentTime(nextTime);
    }
    playingRef.current = false;
    setPlaying(false);
    void audioBufferIteratorRef.current?.return();
    audioBufferIteratorRef.current = null;
    stopAudioNodes();
  }, [getPlaybackTime, stopAudioNodes]);

  const stopRenderLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (renderIntervalRef.current !== null) {
      window.clearInterval(renderIntervalRef.current);
      renderIntervalRef.current = null;
    }
  }, []);

  const drawFrame = useCallback((frame: WrappedCanvas) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(frame.canvas, 0, 0, canvas.width, canvas.height);
  }, []);

  const drawPlaceholder = useCallback((message: string) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    if (!canvas.width || !canvas.height) {
      canvas.width = 1280;
      canvas.height = 720;
    }
    const bodyStyles = getComputedStyle(document.body);
    context.fillStyle = themeValue("--editor-preview-stage", bodyStyles.backgroundColor);
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = themeValue("--editor-preview-overlay-foreground", bodyStyles.color);
    context.font = "24px sans-serif";
    context.textAlign = "center";
    context.fillText(message, canvas.width / 2, canvas.height / 2);
  }, []);

  const startVideoIterator = useCallback(async () => {
    const videoSink = videoSinkRef.current;
    const generation = ++generationRef.current;
    void videoFrameIteratorRef.current?.return();
    videoFrameIteratorRef.current = null;
    nextFrameRef.current = null;

    if (!videoSink) {
      drawPlaceholder("Audio only");
      return;
    }

    const packetRetrievalOptions = skipLiveWaitRef.current ? { skipLiveWait: true } : undefined;
    videoFrameIteratorRef.current = videoSink.canvases(
      toSourceTimelineTime(getPlaybackTime(), sourceTimelineOffsetRef.current),
      Infinity,
      packetRetrievalOptions,
    );
    const firstResult = await videoFrameIteratorRef.current.next();
    const secondResult = await videoFrameIteratorRef.current.next();
    const firstFrame = firstResult.done ? null : (firstResult.value as WrappedCanvas);
    const secondFrame = secondResult.done ? null : (secondResult.value as WrappedCanvas);

    if (generation !== generationRef.current) {
      return;
    }

    nextFrameRef.current = secondFrame;
    if (firstFrame) {
      drawFrame(firstFrame);
    }
  }, [drawFrame, drawPlaceholder, getPlaybackTime]);

  const updateNextFrame = useCallback(async (generation: number) => {
    const iterator = videoFrameIteratorRef.current;
    if (!iterator) {
      return;
    }

    try {
      while (generation === generationRef.current) {
        const result = await iterator.next();
        const newNextFrame = result.done ? null : (result.value as WrappedCanvas);
        if (!newNextFrame || generation !== generationRef.current) {
          break;
        }

        const playbackTime = getPlaybackTime();
        if (
          fromSourceTimelineTime(newNextFrame.timestamp, sourceTimelineOffsetRef.current)
            <= playbackTime
        ) {
          drawFrame(newNextFrame);
        } else {
          nextFrameRef.current = newNextFrame;
          break;
        }
      }
    } catch (err) {
      if (generation === generationRef.current) {
        setError(errorMessage(err));
      }
    }
  }, [drawFrame, getPlaybackTime]);

  const renderFrame = useCallback(() => {
    if (!inputRef.current) {
      return;
    }

    const playbackTime = getPlaybackTime();
    const clipEnd = Math.min(endTimeRef.current || durationRef.current, durationRef.current);

    if (playingRef.current && playbackTime >= clipEnd) {
      pausePlayback(false);
      const nextTime = clampTime(startTimeRef.current);
      playbackTimeAtStartRef.current = nextTime;
      setCurrentTime(nextTime);
      void startVideoIterator();
      return;
    }

    const nextFrame = nextFrameRef.current;
    if (
      nextFrame
      && fromSourceTimelineTime(nextFrame.timestamp, sourceTimelineOffsetRef.current) <= playbackTime
    ) {
      drawFrame(nextFrame);
      nextFrameRef.current = null;
      void updateNextFrame(generationRef.current);
    }

    setCurrentTime(playbackTime);
  }, [clampTime, drawFrame, getPlaybackTime, pausePlayback, startVideoIterator, updateNextFrame]);

  const startRenderLoop = useCallback(() => {
    stopRenderLoop();
    const tick = () => {
      renderFrame();
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
    renderIntervalRef.current = window.setInterval(renderFrame, 500);
  }, [renderFrame, stopRenderLoop]);

  const resetPreview = useCallback((advanceGeneration = false, clearActiveSource = false) => {
    if (advanceGeneration) {
      generationRef.current++;
    }
    warmupGenerationRef.current++;
    if (clearActiveSource) {
      setActiveSourceLabel("");
    }
    pausePlayback(false);
    stopRenderLoop();
    void videoFrameIteratorRef.current?.return();
    void audioBufferIteratorRef.current?.return();
    videoFrameIteratorRef.current = null;
    audioBufferIteratorRef.current = null;
    nextFrameRef.current = null;
    sourceTimelineOffsetRef.current = 0;
    skipLiveWaitRef.current = false;
    warmupPromiseRef.current = null;
    warmupTargetTimeRef.current = null;
    videoSinkRef.current = null;
    audioSinkRef.current = null;
    inputRef.current?.dispose();
    inputRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    gainNodeRef.current = null;
  }, [pausePlayback, stopRenderLoop]);

  const disposePreview = useCallback(() => {
    resetPreview(true, true);
  }, [resetPreview]);

  const runAudioIterator = useCallback(async (generation: number) => {
    const iterator = audioBufferIteratorRef.current;
    const audioContext = audioContextRef.current;
    const gainNode = gainNodeRef.current;
    if (!iterator || !audioContext || !gainNode) {
      return;
    }

    try {
      for await (const { buffer, timestamp } of iterator) {
        if (generation !== generationRef.current || !playingRef.current) {
          break;
        }

        const node = audioContext.createBufferSource();
        node.buffer = buffer;
        node.connect(gainNode);
        const displayTimestamp = fromSourceTimelineTime(timestamp, sourceTimelineOffsetRef.current);

        const startTimestamp = (
          audioContextStartTimeRef.current ?? audioContext.currentTime
        ) + displayTimestamp - playbackTimeAtStartRef.current;

        let started = false;
        if (startTimestamp >= audioContext.currentTime) {
          node.start(startTimestamp);
          started = true;
        } else {
          const offset = audioContext.currentTime - startTimestamp;
          if (offset < buffer.duration) {
            node.start(audioContext.currentTime, offset);
            started = true;
          }
        }

        if (started) {
          queuedAudioNodesRef.current.add(node);
          node.onended = () => {
            queuedAudioNodesRef.current.delete(node);
          };
        }

        if (displayTimestamp - getPlaybackTime() >= 1) {
          await new Promise<void>((resolve) => {
            const intervalId = window.setInterval(() => {
              if (
                generation !== generationRef.current ||
                !playingRef.current ||
                displayTimestamp - getPlaybackTime() < 1
              ) {
                window.clearInterval(intervalId);
                resolve();
              }
            }, 100);
          });
        }
      }
    } catch (err) {
      if (generation === generationRef.current) {
        setError(errorMessage(err));
        pausePlayback();
      }
    }
  }, [getPlaybackTime, pausePlayback]);

  const playPreview = useCallback(async () => {
    if (!inputRef.current || loadingPreview) {
      return;
    }

    const clipStart = clampTime(startTimeRef.current);
    const clipEnd = Math.min(endTimeRef.current || durationRef.current, durationRef.current);
    const pendingWarmup = warmupPromiseRef.current;
    const warmupTargetTime = warmupTargetTimeRef.current;
    if (
      pendingWarmup
      && warmupTargetTime !== null
      && Math.abs(warmupTargetTime - clipStart) < 1e-6
    ) {
      await pendingWarmup.catch(() => undefined);
      if (!inputRef.current || loadingPreview) {
        return;
      }
    }

    const playbackTime = getPlaybackTime();
    if (playbackTime < clipStart || playbackTime >= clipEnd) {
      playbackTimeAtStartRef.current = clipStart;
      setCurrentTime(playbackTimeAtStartRef.current);
      await startVideoIterator();
    }

    let audioContext = audioContextRef.current;
    if (!audioContext) {
      const AudioContextConstructor = getAudioContextConstructor();
      if (!AudioContextConstructor) {
        throw new Error("This browser does not provide Web Audio.");
      }
      audioContext = new AudioContextConstructor();
      audioContextRef.current = audioContext;
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    audioContextStartTimeRef.current = audioContext.currentTime;
    playingRef.current = true;
    setPlaying(true);

    if (audioSinkRef.current) {
      void audioBufferIteratorRef.current?.return();
      const packetRetrievalOptions = skipLiveWaitRef.current ? { skipLiveWait: true } : undefined;
      audioBufferIteratorRef.current = audioSinkRef.current.buffers(
        toSourceTimelineTime(getPlaybackTime(), sourceTimelineOffsetRef.current),
        Infinity,
        packetRetrievalOptions,
      );
      void runAudioIterator(generationRef.current);
    }
  }, [clampTime, getPlaybackTime, loadingPreview, runAudioIterator, startVideoIterator]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      pausePlayback();
      return;
    }

    void playPreview().catch((err) => {
      setPlaying(false);
      playingRef.current = false;
      setError(errorMessage(err));
    });
  }, [pausePlayback, playPreview]);

  const seekToTime = useCallback(async (seconds: number) => {
    const nextTime = clampTime(seconds);
    const wasPlaying = playingRef.current;

    if (wasPlaying) {
      pausePlayback();
    }

    playbackTimeAtStartRef.current = nextTime;
    setCurrentTime(nextTime);
    await startVideoIterator();

    if (wasPlaying && nextTime < endTimeRef.current) {
      void playPreview();
    }
  }, [clampTime, endTimeRef, pausePlayback, playPreview, startVideoIterator]);

  const warmClipStart = useCallback(async (clipStart: number) => {
    if (
      loadingPreview ||
      playingRef.current ||
      activeSourceLabelRef.current !== "HLS stream"
    ) {
      return;
    }

    const videoSink = videoSinkRef.current;
    const audioSink = audioSinkRef.current;
    if (!videoSink && !audioSink) {
      return;
    }

    const displayTimestamp = Number(clampTime(clipStart).toFixed(6));
    if (!Number.isFinite(displayTimestamp)) {
      return;
    }
    if (
      warmupPromiseRef.current
      && warmupTargetTimeRef.current !== null
      && Math.abs(warmupTargetTimeRef.current - displayTimestamp) < 1e-6
    ) {
      return warmupPromiseRef.current;
    }

    const sourceTimestamp = toSourceTimelineTime(displayTimestamp, sourceTimelineOffsetRef.current);
    const packetRetrievalOptions = skipLiveWaitRef.current ? { skipLiveWait: true } : undefined;
    const warmupGeneration = ++warmupGenerationRef.current;
    const playbackGeneration = generationRef.current;
    warmupTargetTimeRef.current = displayTimestamp;

    const warmupPromise = (async () => {
      if (
        warmupGeneration !== warmupGenerationRef.current ||
        playbackGeneration !== generationRef.current ||
        playingRef.current
      ) {
        return;
      }

      try {
        await Promise.allSettled([
          videoSink ? videoSink.getCanvas(sourceTimestamp, packetRetrievalOptions) : Promise.resolve(null),
          audioSink ? audioSink.getBuffer(sourceTimestamp, packetRetrievalOptions) : Promise.resolve(null),
        ]);
      } catch {
        // Warmup is opportunistic; playback still works without it.
      }
    })();

    warmupPromiseRef.current = warmupPromise;
    try {
      await warmupPromise;
    } finally {
      if (warmupPromiseRef.current === warmupPromise) {
        warmupPromiseRef.current = null;
        warmupTargetTimeRef.current = null;
      }
    }
  }, [clampTime, loadingPreview]);

  useEffect(() => {
    const playbackSources = buildPlaybackSourceCandidates(hlsUrl, mediaUrl);
    const directSourceUrl = playbackSources.find((source) => source.label === "direct source")?.url;
    if (playbackSources.length === 0) {
      return;
    }

    let cancelled = false;
    disposePreview();
    const generation = generationRef.current;

    async function loadPreview() {
      const resetDuration = Math.max(initialDuration, 0);
      setLoadingPreview(true);
      setPreviewStatus("Loading stream...");
      setError("");
      setActiveSourceLabel("");
      setExportFallbackSourceUrl(undefined);
      setHlsFallbackInfo(null);
      setDuration(resetDuration);
      durationRef.current = resetDuration;
      setSourceVideoDimensions(null);
      setCurrentTime(0);
      playbackTimeAtStartRef.current = 0;
      sourceTimelineOffsetRef.current = 0;
      skipLiveWaitRef.current = false;

      try {
        const failures: PlaybackLoadFailure[] = [];
        let nextExportFallbackSourceUrl: string | undefined;
        let nextHlsFallbackInfo: PlaybackFallbackInfo | null = null;

        for (const playbackSource of playbackSources) {
          setPreviewStatus(
            failures.length === 0
              ? `Loading ${playbackSource.label}...`
              : `${describePlaybackFailure(failures[failures.length - 1])} Retrying with ${playbackSource.label}...`
          );

          try {
            await ensureMediabunnyCodecs();
            const { AudioBufferSink, CanvasSink } = await import("mediabunny");

            if (cancelled || generation !== generationRef.current) {
              return;
            }

            const input = await createCliparrInputFromUrl(playbackSource.url);
            inputRef.current = input;

            const videoTracks = await input.getVideoTracks({
              filter: async (track) => !(await track.hasOnlyKeyPackets()),
            });
            const {
              sourceVideoTrack,
              previewVideoTrack,
              warnings,
            } = await selectPreviewVideoTrack(videoTracks);
            const allAudioTracks = await input.getAudioTracks();
            const sourceAudioTrack = await selectPreferredPairableAudioTrack(
              sourceVideoTrack,
              allAudioTracks,
              selectedAudioTrack
            );
            let previewAudioTrack = await selectPreferredPairableAudioTrack(
              previewVideoTrack,
              allAudioTracks,
              selectedAudioTrack
            );
            const sourceTracks: InputTrack[] = [sourceVideoTrack, sourceAudioTrack].filter(isPresent);
            const timelineTracks = sourceTracks.length > 0
              ? sourceTracks
              : [previewVideoTrack, previewAudioTrack].filter(isPresent);
            const trackLiveRefreshIntervals = await Promise.all(
              timelineTracks.map((track) => track.getLiveRefreshInterval())
            );
            const isLivePlayback = trackLiveRefreshIntervals.some((value) => value !== null);
            skipLiveWaitRef.current = isLivePlayback;

            const previewAudioAssessment = await assessPreviewAudioTrack(previewAudioTrack);
            previewAudioTrack = previewAudioAssessment.track;
            if (previewAudioAssessment.warning) {
              warnings.push(previewAudioAssessment.warning);
            }

            if (cancelled || generation !== generationRef.current) {
              return;
            }

            if (!previewVideoTrack && !previewAudioTrack) {
              throw new PlaybackSourceError(
                "preview-only",
                warnings.join(" ") || "No decodable audio or video track found."
              );
            }

            const durationTracks = sourceTracks;
            const timelineOffsetSeconds = await getTrackTimelineOffsetSeconds(durationTracks);
            sourceTimelineOffsetRef.current = timelineOffsetSeconds;
            const metadataDuration = durationTracks.length > 0
              ? await input.getDurationFromMetadata(
                durationTracks,
                isLivePlayback ? { skipLiveWait: true } : undefined
              )
              : null;
            const sourceTimelineEnd = durationTracks.length > 0
              ? metadataDuration && metadataDuration > 0
                ? metadataDuration
                : await input.computeDuration(
                  durationTracks,
                  isLivePlayback ? { skipLiveWait: true } : undefined
                )
              : Math.max(initialDuration, 0);
            const nextDuration = Math.max(
              0,
              fromSourceTimelineTime(sourceTimelineEnd, timelineOffsetSeconds)
            ) || Math.max(initialDuration, 0);
            setDuration(nextDuration);
            durationRef.current = nextDuration;
            setCurrentTime(0);
            playbackTimeAtStartRef.current = 0;

            const sourceDimensions = sourceVideoTrack
              ? await getVideoTrackDimensions(sourceVideoTrack)
              : null;
            const audioTrackSampleRate = previewAudioTrack
              ? await getAudioTrackSampleRate(previewAudioTrack)
              : undefined;

            if (sourceDimensions) {
              setSourceVideoDimensions(sourceDimensions);
              const canvas = canvasRef.current;
              if (canvas) {
                canvas.width = sourceDimensions.width;
                canvas.height = sourceDimensions.height;
              }
            }

            try {
              if (previewVideoTrack) {
                videoSinkRef.current = new CanvasSink(previewVideoTrack, {
                  poolSize: 2,
                  fit: "contain",
                  alpha: await previewVideoTrack.canBeTransparent(),
                });
              }

              if (previewAudioTrack) {
                const AudioContextConstructor = getAudioContextConstructor();
                if (!AudioContextConstructor) {
                  throw new PlaybackSourceError(
                    "preview-only",
                    "This browser does not provide Web Audio."
                  );
                }
                const audioContext = new AudioContextConstructor({
                  sampleRate: audioTrackSampleRate,
                });
                const gainNode = audioContext.createGain();
                const actualVolume = mutedRef.current || volumeRef.current === 0 ? 0 : volumeRef.current;
                gainNode.gain.value = actualVolume ** 2;
                gainNode.connect(audioContext.destination);
                audioContextRef.current = audioContext;
                gainNodeRef.current = gainNode;
                audioSinkRef.current = new AudioBufferSink(previewAudioTrack);
              }

              await startVideoIterator();
            } catch (err) {
              throw err instanceof PlaybackSourceError
                ? err
                : new PlaybackSourceError("preview-only", errorMessage(err));
            }

            startRenderLoop();
            setActiveSourceLabel(formatPlaybackSourceLabel(playbackSource.label));
            setExportFallbackSourceUrl(
              playbackSource.label === "direct source" ? nextExportFallbackSourceUrl : undefined
            );
            setHlsFallbackInfo(
              playbackSource.label === "direct source" ? nextHlsFallbackInfo : null
            );
            return;
          } catch (err) {
            const failure = buildPlaybackFailure(playbackSource, err);
            failures.push(failure);

            if (
              failure.label === "hls stream"
              && shouldUseExportFallback(failure)
              && directSourceUrl
            ) {
              nextExportFallbackSourceUrl = directSourceUrl;
            }

            if (failure.label === "hls stream") {
              nextHlsFallbackInfo = {
                category: failure.category,
                message: failure.message,
              };
            }

            console.warn("Editor playback source failed", {
              sessionId,
              source: failure.label,
              classification: failure.classification,
              category: failure.category,
              message: failure.message,
            });

            if (cancelled) {
              return;
            }

            resetPreview(false);
          }
        }

        if (!cancelled) {
          setError(buildPlaybackLoadError(failures));
          setHlsFallbackInfo(nextHlsFallbackInfo);
          setSourceVideoDimensions(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingPreview(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
      disposePreview();
    };
  }, [
    mediaUrl,
    hlsUrl,
    initialDuration,
    selectedAudioTrack,
    sessionId,
    disposePreview,
    resetPreview,
    startRenderLoop,
    startVideoIterator,
  ]);

  return {
    canvasRef,
    currentTime,
    duration,
    playing,
    loadingPreview,
    previewStatus,
    error,
    activeSourceLabel,
    exportFallbackSourceUrl,
    hlsFallbackInfo,
    sourceVideoDimensions,
    volume,
    muted,
    setVolume,
    setMuted,
    togglePlay,
    pausePlayback,
    seekToTime,
    warmClipStart,
    setCurrentTime,
    playbackTimeAtStartRef,
  };
}
