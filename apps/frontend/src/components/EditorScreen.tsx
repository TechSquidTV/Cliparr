import {
  startTransition,
  type ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Timeline, type TimelineState } from "@xzdarcy/react-timeline-editor";
import "@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css";
import type { AudioBufferSink, CanvasSink, Input, WrappedAudioBuffer, WrappedCanvas } from "mediabunny";
import { ArrowLeft, Download, Pause, Play, Scissors, Volume2, VolumeX } from "lucide-react";
import { ensureMediabunnyCodecs } from "../lib/mediabunnyCodecs";
import type { CurrentlyPlayingItem } from "../providers/types";

interface Props {
  session: CurrentlyPlayingItem;
  onBack: () => void;
}

const MIN_CLIP_SECONDS = 0.1;
const TIMELINE_START_LEFT = 24;
const MAX_TIMELINE_ZOOM_SCALE_COUNT = 2000;
const TIMELINE_ZOOM_WHEEL_STEP = 24;
const TIMELINE_ZOOM_WIDTH_MULTIPLIERS = [0.72, 0.84, 0.96, 1.08, 1.2] as const;

type ClipTimelineData = ComponentProps<typeof Timeline>["editorData"];
type ClipTimelineEffects = ComponentProps<typeof Timeline>["effects"];
type ClipTimelineAction = ClipTimelineData[number]["actions"][number];
type TimelineZoomPreset = {
  scale: number;
  scaleSplitCount: number;
  scaleWidth: number;
};
type TimelineZoomLevel = TimelineZoomPreset;

const TIMELINE_ZOOM_PRESETS: readonly TimelineZoomPreset[] = [
  { scale: 1, scaleSplitCount: 10, scaleWidth: 160 },
  { scale: 2, scaleSplitCount: 8, scaleWidth: 152 },
  { scale: 5, scaleSplitCount: 5, scaleWidth: 120 },
  { scale: 10, scaleSplitCount: 5, scaleWidth: 124 },
  { scale: 15, scaleSplitCount: 5, scaleWidth: 128 },
  { scale: 30, scaleSplitCount: 6, scaleWidth: 136 },
  { scale: 60, scaleSplitCount: 6, scaleWidth: 140 },
  { scale: 120, scaleSplitCount: 6, scaleWidth: 144 },
  { scale: 300, scaleSplitCount: 5, scaleWidth: 148 },
  { scale: 600, scaleSplitCount: 5, scaleWidth: 152 },
];

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Preview failed to load";
}

function isAc3FamilyCodec(codec: string | null) {
  return codec === "ac3" || codec === "eac3";
}

function roundTimelineTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return 0;
  }

  return Math.round(seconds * 100) / 100;
}

function timelineScaleForDuration(seconds: number) {
  if (seconds <= 60) {
    return { scale: 5, scaleSplitCount: 5, scaleWidth: 120 };
  }

  if (seconds <= 5 * 60) {
    return { scale: 15, scaleSplitCount: 5, scaleWidth: 128 };
  }

  if (seconds <= 30 * 60) {
    return { scale: 60, scaleSplitCount: 6, scaleWidth: 140 };
  }

  return { scale: 5 * 60, scaleSplitCount: 5, scaleWidth: 148 };
}

function getTimelineZoomWidthLevels(preset: TimelineZoomPreset) {
  return TIMELINE_ZOOM_WIDTH_MULTIPLIERS.map((widthMultiplier) => ({
    scale: preset.scale,
    scaleSplitCount: preset.scaleSplitCount,
    scaleWidth: Math.max(72, Math.round((preset.scaleWidth * widthMultiplier) / 4) * 4),
  }));
}

function getTimelineZoomLevels(seconds: number) {
  const safeDuration = Math.max(seconds, MIN_CLIP_SECONDS);
  const availableLevels = new Map<string, TimelineZoomLevel>();

  for (const preset of TIMELINE_ZOOM_PRESETS) {
    if (Math.ceil(safeDuration / preset.scale) > MAX_TIMELINE_ZOOM_SCALE_COUNT) {
      continue;
    }

    for (const zoomLevel of getTimelineZoomWidthLevels(preset)) {
      availableLevels.set(
        `${zoomLevel.scale}:${zoomLevel.scaleSplitCount}:${zoomLevel.scaleWidth}`,
        zoomLevel,
      );
    }
  }

  if (availableLevels.size === 0) {
    const fallbackPreset = TIMELINE_ZOOM_PRESETS[TIMELINE_ZOOM_PRESETS.length - 1];
    const minimumSafeScale = Math.max(1, Math.ceil(safeDuration / MAX_TIMELINE_ZOOM_SCALE_COUNT));
    return getTimelineZoomWidthLevels({
      scale: Math.max(fallbackPreset.scale, minimumSafeScale),
      scaleSplitCount: fallbackPreset.scaleSplitCount,
      scaleWidth: fallbackPreset.scaleWidth,
    });
  }

  return [...availableLevels.values()].sort((left, right) => {
    const zoomDensityDifference = (right.scaleWidth / right.scale) - (left.scaleWidth / left.scale);
    if (zoomDensityDifference !== 0) {
      return zoomDensityDifference;
    }

    return left.scale - right.scale;
  });
}

function getClosestTimelineZoomIndex(levels: readonly TimelineZoomLevel[], targetScale: TimelineZoomPreset) {
  const targetZoomDensity = targetScale.scaleWidth / targetScale.scale;

  return levels.reduce((closestIndex, level, index) => {
    const closestLevel = levels[closestIndex];
    const closestDensityDistance = Math.abs((closestLevel.scaleWidth / closestLevel.scale) - targetZoomDensity);
    const nextDensityDistance = Math.abs((level.scaleWidth / level.scale) - targetZoomDensity);

    if (nextDensityDistance !== closestDensityDistance) {
      return nextDensityDistance < closestDensityDistance ? index : closestIndex;
    }

    const closestScaleDistance = Math.abs(closestLevel.scale - targetScale.scale);
    const nextScaleDistance = Math.abs(level.scale - targetScale.scale);
    return nextScaleDistance < closestScaleDistance ? index : closestIndex;
  }, 0);
}

function timelinePixelToTime(pixel: number, scale: number, scaleWidth: number, startLeft: number) {
  return ((pixel - startLeft) / scaleWidth) * scale;
}

function timelineTimeToPixel(time: number, scale: number, scaleWidth: number, startLeft: number) {
  return startLeft + (time / scale) * scaleWidth;
}

function normalizeWheelDelta(
  deltaY: number,
  deltaMode: number,
  containerSize: number,
) {
  switch (deltaMode) {
    case 1:
      return deltaY * 16;
    case 2:
      return deltaY * containerSize;
    default:
      return deltaY;
  }
}

function getTimelineMaxScrollLeft(
  duration: number,
  scale: number,
  scaleWidth: number,
  viewportWidth: number,
) {
  return Math.max(
    0,
    Math.ceil(Math.max(duration, MIN_CLIP_SECONDS) / scale) * scaleWidth
    + TIMELINE_START_LEFT
    - viewportWidth,
  );
}

function getTimelineZoomLevel(
  levels: readonly TimelineZoomLevel[],
  index: number,
  fallback: TimelineZoomLevel,
) {
  return levels[index] ?? fallback;
}

function themeValue(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export default function EditorScreen({ session, onBack }: Props) {
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(() => Math.min(10, Math.max(session.duration, 0)));
  const [duration, setDuration] = useState(() => Math.max(session.duration, 0));
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewStatus, setPreviewStatus] = useState("Loading preview...");
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resolution, setResolution] = useState<"original" | "1080" | "720">("original");
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");

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
  const timelineRef = useRef<TimelineState>(null);
  const playingRef = useRef(false);
  const audioContextStartTimeRef = useRef<number | null>(null);
  const playbackTimeAtStartRef = useRef(0);
  const durationRef = useRef(duration);
  const startTimeRef = useRef(startTime);
  const endTimeRef = useRef(endTime);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);
  const timelineWheelRegionRef = useRef<HTMLDivElement>(null);
  const timelineScrollLeftRef = useRef(0);
  const pendingTimelineScrollLeftRef = useRef<number | null>(null);
  const timelineWheelDeltaRef = useRef(0);
  const startVideoIteratorRef = useRef<(() => Promise<void>) | null>(null);
  const startRenderLoopRef = useRef<(() => void) | null>(null);
  const disposePreviewRef = useRef<(() => void) | null>(null);

  const mediaUrl = session.mediaUrl ?? "";
  const hasDuration = duration > 0;
  const timelineEffects = useMemo<ClipTimelineEffects>(
    () => ({
      source: {
        id: "source",
        name: "Full video",
      },
      clip: {
        id: "clip",
        name: "Clip",
      },
    }),
    [],
  );
  const defaultTimelineScale = useMemo(() => timelineScaleForDuration(duration), [duration]);
  const availableTimelineZoomLevels = useMemo(() => getTimelineZoomLevels(duration), [duration]);
  const defaultTimelineZoomIndex = useMemo(
    () => getClosestTimelineZoomIndex(availableTimelineZoomLevels, defaultTimelineScale),
    [availableTimelineZoomLevels, defaultTimelineScale],
  );
  const [timelineZoomIndex, setTimelineZoomIndex] = useState(defaultTimelineZoomIndex);
  const activeTimelineScale = getTimelineZoomLevel(
    availableTimelineZoomLevels,
    timelineZoomIndex,
    getTimelineZoomLevel(availableTimelineZoomLevels, defaultTimelineZoomIndex, defaultTimelineScale),
  );
  const timelineZoomIndexRef = useRef(timelineZoomIndex);
  const timelineScaleCount = useMemo(
    () => Math.max(1, Math.ceil(Math.max(duration, MIN_CLIP_SECONDS) / activeTimelineScale.scale)),
    [duration, activeTimelineScale.scale],
  );
  const timelineData = useMemo<ClipTimelineData>(() => {
    const clipLength = hasDuration ? Math.min(MIN_CLIP_SECONDS, duration) : MIN_CLIP_SECONDS;
    const safeDuration = hasDuration ? roundTimelineTime(duration) : MIN_CLIP_SECONDS;
    const safeStart = hasDuration
      ? roundTimelineTime(Math.min(Math.max(startTime, 0), Math.max(duration - clipLength, 0)))
      : 0;
    const safeEnd = hasDuration
      ? roundTimelineTime(Math.min(Math.max(endTime, safeStart + clipLength), duration))
      : MIN_CLIP_SECONDS;

    return [
      {
        id: "source-media",
        rowHeight: 32,
        actions: [
          {
            id: "full-video",
            start: 0,
            end: safeDuration,
            effectId: "source",
            flexible: false,
            movable: false,
            minStart: 0,
            maxEnd: safeDuration,
          },
        ],
      },
      {
        id: "clip-range",
        rowHeight: 44,
        selected: true,
        actions: [
          {
            id: "selected-clip",
            start: safeStart,
            end: safeEnd,
            effectId: "clip",
            selected: true,
            flexible: hasDuration,
            movable: hasDuration,
            minStart: 0,
            maxEnd: Math.max(duration, safeEnd),
          },
        ],
      },
    ];
  }, [duration, endTime, hasDuration, startTime]);

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
    volumeRef.current = volume;
    mutedRef.current = muted;
    if (gainNodeRef.current) {
      const actualVolume = muted || volume === 0 ? 0 : volume;
      gainNodeRef.current.gain.value = actualVolume ** 2;
    }
  }, [volume, muted]);

  useEffect(() => {
    timelineZoomIndexRef.current = timelineZoomIndex;
  }, [timelineZoomIndex]);

  useEffect(() => {
    setTimelineZoomIndex(defaultTimelineZoomIndex);
    timelineZoomIndexRef.current = defaultTimelineZoomIndex;
    timelineScrollLeftRef.current = 0;
    timelineWheelDeltaRef.current = 0;
    timelineRef.current?.setScrollLeft(0);
    pendingTimelineScrollLeftRef.current = 0;
  }, [defaultTimelineZoomIndex, session.id]);

  useEffect(() => {
    const pendingScrollLeft = pendingTimelineScrollLeftRef.current;
    if (pendingScrollLeft === null) {
      return;
    }

    timelineRef.current?.setScrollLeft(pendingScrollLeft);
    timelineScrollLeftRef.current = pendingScrollLeft;
    pendingTimelineScrollLeftRef.current = null;
  }, [activeTimelineScale.scale, activeTimelineScale.scaleWidth]);

  const clampTime = (seconds: number) => {
    const maxDuration = durationRef.current;
    if (!Number.isFinite(maxDuration) || maxDuration <= 0) {
      return 0;
    }

    return Math.min(Math.max(seconds, 0), maxDuration);
  };

  const getPlaybackTime = () => {
    if (
      playingRef.current
      && audioContextRef.current
      && audioContextStartTimeRef.current !== null
    ) {
      return clampTime(
        audioContextRef.current.currentTime
        - audioContextStartTimeRef.current
        + playbackTimeAtStartRef.current
      );
    }

    return clampTime(playbackTimeAtStartRef.current);
  };

  const stopAudioNodes = () => {
    for (const node of queuedAudioNodesRef.current) {
      try {
        node.stop();
      } catch {
        // The node may have already ended.
      }
    }
    queuedAudioNodesRef.current.clear();
  };

  const pausePlayback = (storeCurrentTime = true) => {
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
  };

  const stopRenderLoop = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (renderIntervalRef.current !== null) {
      window.clearInterval(renderIntervalRef.current);
      renderIntervalRef.current = null;
    }
  };

  const drawFrame = (frame: WrappedCanvas) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(frame.canvas, 0, 0, canvas.width, canvas.height);
  };

  const drawPlaceholder = (message: string) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    if (!canvas.width || !canvas.height) {
      canvas.width = 1280;
      canvas.height = 720;
    }

    context.fillStyle = themeValue("--background", "oklch(0.1591 0 0)");
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = themeValue("--muted-foreground", "oklch(0.6268 0 0)");
    context.font = "24px sans-serif";
    context.textAlign = "center";
    context.fillText(message, canvas.width / 2, canvas.height / 2);
  };

  const startVideoIterator = async () => {
    const videoSink = videoSinkRef.current;
    const generation = ++generationRef.current;
    void videoFrameIteratorRef.current?.return();
    videoFrameIteratorRef.current = null;
    nextFrameRef.current = null;

    if (!videoSink) {
      drawPlaceholder("Audio preview");
      return;
    }

    videoFrameIteratorRef.current = videoSink.canvases(getPlaybackTime());
    const firstResult = await videoFrameIteratorRef.current.next();
    const secondResult = await videoFrameIteratorRef.current.next();
    const firstFrame = firstResult.done ? null : firstResult.value as WrappedCanvas;
    const secondFrame = secondResult.done ? null : secondResult.value as WrappedCanvas;

    if (generation !== generationRef.current) {
      return;
    }

    nextFrameRef.current = secondFrame;
    if (firstFrame) {
      drawFrame(firstFrame);
    }
  };
  startVideoIteratorRef.current = startVideoIterator;

  const updateNextFrame = async (generation: number) => {
    const iterator = videoFrameIteratorRef.current;
    if (!iterator) {
      return;
    }

    try {
      while (generation === generationRef.current) {
        const result = await iterator.next();
        const newNextFrame = result.done ? null : result.value as WrappedCanvas;
        if (!newNextFrame || generation !== generationRef.current) {
          break;
        }

        const playbackTime = getPlaybackTime();
        if (newNextFrame.timestamp <= playbackTime) {
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
  };

  const renderFrame = () => {
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
    if (nextFrame && nextFrame.timestamp <= playbackTime) {
      drawFrame(nextFrame);
      nextFrameRef.current = null;
      void updateNextFrame(generationRef.current);
    }

    setCurrentTime(playbackTime);
  };

  const startRenderLoop = () => {
    stopRenderLoop();

    const tick = () => {
      renderFrame();
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
    renderIntervalRef.current = window.setInterval(renderFrame, 500);
  };
  startRenderLoopRef.current = startRenderLoop;

  const disposePreview = () => {
    generationRef.current++;
    pausePlayback(false);
    stopRenderLoop();
    void videoFrameIteratorRef.current?.return();
    void audioBufferIteratorRef.current?.return();
    videoFrameIteratorRef.current = null;
    audioBufferIteratorRef.current = null;
    nextFrameRef.current = null;
    videoSinkRef.current = null;
    audioSinkRef.current = null;
    inputRef.current?.dispose();
    inputRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    gainNodeRef.current = null;
  };
  disposePreviewRef.current = disposePreview;

  const runAudioIterator = async (generation: number) => {
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

        const startTimestamp = (
          audioContextStartTimeRef.current ?? audioContext.currentTime
        ) + timestamp - playbackTimeAtStartRef.current;

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

        if (timestamp - getPlaybackTime() >= 1) {
          await new Promise<void>((resolve) => {
            const intervalId = window.setInterval(() => {
              if (
                generation !== generationRef.current
                || !playingRef.current
                || timestamp - getPlaybackTime() < 1
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
  };

  const playPreview = async () => {
    if (!inputRef.current || loadingPreview) {
      return;
    }

    const clipEnd = Math.min(endTimeRef.current || durationRef.current, durationRef.current);
    if (getPlaybackTime() >= clipEnd) {
      playbackTimeAtStartRef.current = clampTime(startTimeRef.current);
      setCurrentTime(playbackTimeAtStartRef.current);
      await startVideoIterator();
    }

    let audioContext = audioContextRef.current;
    if (!audioContext) {
      const AudioContextConstructor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
      audioBufferIteratorRef.current = audioSinkRef.current.buffers(getPlaybackTime());
      void runAudioIterator(generationRef.current);
    }
  };

  const togglePlay = () => {
    if (playingRef.current) {
      pausePlayback();
      return;
    }

    void playPreview().catch((err) => {
      setPlaying(false);
      playingRef.current = false;
      setError(errorMessage(err));
    });
  };

  const seekToTime = async (seconds: number) => {
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
  };

  const isValidTimelineRange = useCallback((nextStart: number, nextEnd: number) => {
    const maxDuration = durationRef.current;
    const minClipLength = Math.min(MIN_CLIP_SECONDS, maxDuration);

    return (
      hasDuration
      && nextStart >= 0
      && nextEnd <= maxDuration
      && nextEnd - nextStart >= minClipLength
    );
  }, [hasDuration]);

  const updateClipRange = useCallback((nextStart: number, nextEnd: number) => {
    const maxDuration = durationRef.current;
    if (!maxDuration || maxDuration <= 0) {
      return;
    }

    const minClipLength = Math.min(MIN_CLIP_SECONDS, maxDuration);
    const boundedStart = Math.min(Math.max(nextStart, 0), Math.max(maxDuration - minClipLength, 0));
    const boundedEnd = Math.min(Math.max(nextEnd, boundedStart + minClipLength), maxDuration);
    const roundedStart = roundTimelineTime(boundedStart);
    const roundedEnd = roundTimelineTime(boundedEnd);

    startTimeRef.current = roundedStart;
    endTimeRef.current = roundedEnd;
    setStartTime(roundedStart);
    setEndTime(roundedEnd);

    const currentPreviewTime = playbackTimeAtStartRef.current;
    if (currentPreviewTime < roundedStart || currentPreviewTime > roundedEnd) {
      playbackTimeAtStartRef.current = roundedStart;
      setCurrentTime(roundedStart);
      void startVideoIteratorRef.current?.();
    }
  }, []);

  const handleTimelineChange = useCallback((nextData: ClipTimelineData) => {
    const nextAction = nextData
      .flatMap((row) => row.actions)
      .find((action) => action.id === "selected-clip");
    if (!nextAction) {
      return false;
    }

    updateClipRange(nextAction.start, nextAction.end);
  }, [updateClipRange]);

  const renderClipTimelineAction = useCallback((action: ClipTimelineAction) => (
    <div className="cliparr-timeline-action-content">
      <span className="cliparr-timeline-action-label">
        {action.effectId === "clip" && <Scissors className="h-3.5 w-3.5" />}
        {action.effectId === "source" ? "Full video" : "Clip"}
      </span>
      <span className="cliparr-timeline-action-time">
        {action.effectId === "source"
          ? formatTime(action.end)
          : `${formatTime(action.start)} - ${formatTime(action.end)}`}
      </span>
    </div>
  ), []);

  useEffect(() => {
    if (!timelineRef.current || !hasDuration) {
      return;
    }

    timelineRef.current.setTime(clampTime(currentTime));
  }, [currentTime, duration, hasDuration]);

  const handleTimelineScroll = useCallback(({ scrollLeft }: { scrollLeft: number }) => {
    timelineScrollLeftRef.current = scrollLeft;
  }, []);

  const handleTimelineWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!hasDuration) {
      return;
    }

    const timelineWheelRegion = timelineWheelRegionRef.current;
    if (!timelineWheelRegion) {
      return;
    }

    const containerHeight = timelineWheelRegion.clientHeight || 1;
    const containerWidth = timelineWheelRegion.clientWidth || 1;

    if (!event.metaKey && !event.ctrlKey) {
      timelineWheelDeltaRef.current = 0;
      const horizontalWheelDelta = normalizeWheelDelta(event.deltaX, event.deltaMode, containerWidth);
      const verticalWheelDelta = normalizeWheelDelta(event.deltaY, event.deltaMode, containerHeight);
      const nextScrollDelta = horizontalWheelDelta + verticalWheelDelta;
      const maxScrollLeft = getTimelineMaxScrollLeft(
        duration,
        activeTimelineScale.scale,
        activeTimelineScale.scaleWidth,
        containerWidth,
      );
      if (nextScrollDelta === 0 || maxScrollLeft <= 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const nextScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, timelineScrollLeftRef.current + nextScrollDelta),
      );
      timelineRef.current?.setScrollLeft(nextScrollLeft);
      timelineScrollLeftRef.current = nextScrollLeft;
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const normalizedDeltaY = normalizeWheelDelta(event.deltaY, event.deltaMode, containerHeight);
    if (normalizedDeltaY === 0 || availableTimelineZoomLevels.length < 2) {
      return;
    }

    if (
      timelineWheelDeltaRef.current !== 0
      && Math.sign(timelineWheelDeltaRef.current) !== Math.sign(normalizedDeltaY)
    ) {
      timelineWheelDeltaRef.current = 0;
    }

    timelineWheelDeltaRef.current += normalizedDeltaY;
    const zoomDelta = Math.trunc(timelineWheelDeltaRef.current / TIMELINE_ZOOM_WHEEL_STEP);
    if (zoomDelta === 0) {
      return;
    }

    const currentZoomIndex = timelineZoomIndexRef.current;
    const currentTimelineScale = getTimelineZoomLevel(
      availableTimelineZoomLevels,
      currentZoomIndex,
      activeTimelineScale,
    );
    const currentScrollLeft = pendingTimelineScrollLeftRef.current ?? timelineScrollLeftRef.current;
    timelineWheelDeltaRef.current -= zoomDelta * TIMELINE_ZOOM_WHEEL_STEP;
    const nextZoomIndex = Math.min(
      availableTimelineZoomLevels.length - 1,
      Math.max(0, currentZoomIndex + zoomDelta),
    );
    if (nextZoomIndex === currentZoomIndex) {
      timelineWheelDeltaRef.current = 0;
      return;
    }

    const nextTimelineScale = getTimelineZoomLevel(
      availableTimelineZoomLevels,
      nextZoomIndex,
      currentTimelineScale,
    );
    const regionRect = timelineWheelRegion.getBoundingClientRect();
    const pointerX = Math.min(Math.max(event.clientX - regionRect.left, 0), regionRect.width);
    const anchorPixel = Math.max(
      TIMELINE_START_LEFT,
      currentScrollLeft + pointerX,
    );
    const anchorTime = Math.min(
      duration,
      Math.max(
        0,
        timelinePixelToTime(
          anchorPixel,
          currentTimelineScale.scale,
          currentTimelineScale.scaleWidth,
          TIMELINE_START_LEFT,
        ),
      ),
    );
    const nextAnchorPixel = timelineTimeToPixel(
      anchorTime,
      nextTimelineScale.scale,
      nextTimelineScale.scaleWidth,
      TIMELINE_START_LEFT,
    );
    const nextMaxScrollLeft = getTimelineMaxScrollLeft(
      duration,
      nextTimelineScale.scale,
      nextTimelineScale.scaleWidth,
      regionRect.width,
    );
    const nextScrollLeft = Math.min(
      nextMaxScrollLeft,
      Math.max(0, nextAnchorPixel - pointerX),
    );
    pendingTimelineScrollLeftRef.current = nextScrollLeft;
    timelineScrollLeftRef.current = nextScrollLeft;
    timelineZoomIndexRef.current = nextZoomIndex;

    startTransition(() => {
      setTimelineZoomIndex(nextZoomIndex);
    });
  }, [
    hasDuration,
    availableTimelineZoomLevels,
    duration,
      activeTimelineScale,
    ]);

  useEffect(() => {
    if (!mediaUrl) {
      return;
    }

    let cancelled = false;
    disposePreviewRef.current?.();
    const generation = generationRef.current;

    async function loadPreview() {
      setLoadingPreview(true);
      setPreviewStatus("Loading preview...");
      setError("");
      setCurrentTime(0);
      playbackTimeAtStartRef.current = 0;

      try {
        await ensureMediabunnyCodecs();
        const { ALL_FORMATS, AudioBufferSink, CanvasSink, Input, UrlSource } = await import("mediabunny");

        if (cancelled || generation !== generationRef.current) {
          return;
        }

        const input = new Input({
          source: new UrlSource(mediaUrl),
          formats: ALL_FORMATS,
        });
        inputRef.current = input;

        const computedDuration = await input.computeDuration();
        let videoTrack = await input.getPrimaryVideoTrack();
        let audioTrack = await input.getPrimaryAudioTrack();
        const warnings: string[] = [];

        if (videoTrack) {
          if (videoTrack.codec === null) {
            warnings.push("Video codec is unknown.");
            videoTrack = null;
          } else if (!(await videoTrack.canDecode())) {
            warnings.push(`Cannot decode ${videoTrack.codec} video in this browser.`);
            videoTrack = null;
          }
        }

        if (audioTrack) {
          const audioCodec = audioTrack.codec;
          if (audioCodec === null) {
            warnings.push("Audio codec is unknown.");
            audioTrack = null;
          } else if (!(await audioTrack.canDecode()) && !isAc3FamilyCodec(audioCodec)) {
            warnings.push(`Cannot decode ${audioCodec} audio in this browser.`);
            audioTrack = null;
          }
        }

        if (cancelled || generation !== generationRef.current) {
          return;
        }

        if (!videoTrack && !audioTrack) {
          throw new Error(warnings.join(" ") || "No decodable audio or video track found.");
        }

        const nextDuration = computedDuration > 0 ? computedDuration : Math.max(session.duration, 0);
        setDuration(nextDuration);
        durationRef.current = nextDuration;
        setStartTime(0);
        startTimeRef.current = 0;
        const nextEndTime = Math.min(10, nextDuration);
        setEndTime(nextEndTime);
        endTimeRef.current = nextEndTime;

        if (videoTrack) {
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width = videoTrack.displayWidth;
            canvas.height = videoTrack.displayHeight;
          }

          videoSinkRef.current = new CanvasSink(videoTrack, {
            poolSize: 2,
            fit: "contain",
            alpha: await videoTrack.canBeTransparent(),
          });
        }

        if (audioTrack) {
          const AudioContextConstructor = window.AudioContext
            ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioContextConstructor) {
            throw new Error("This browser does not provide Web Audio.");
          }

          const audioContext = new AudioContextConstructor({ sampleRate: audioTrack.sampleRate });
          const gainNode = audioContext.createGain();
          const actualVolume = mutedRef.current || volumeRef.current === 0 ? 0 : volumeRef.current;
          gainNode.gain.value = actualVolume ** 2;
          gainNode.connect(audioContext.destination);
          audioContextRef.current = audioContext;
          gainNodeRef.current = gainNode;
          audioSinkRef.current = new AudioBufferSink(audioTrack);
        }

        await startVideoIteratorRef.current?.();
        startRenderLoopRef.current?.();
      } catch (err) {
        if (!cancelled) {
          disposePreviewRef.current?.();
          setError(errorMessage(err));
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
      disposePreviewRef.current?.();
    };
  }, [mediaUrl, session.duration, session.id]);

  const handleExport = async () => {
    if (!mediaUrl) return;
    setExporting(true);
    setError("");
    setProgress(0);

    try {
      const { exportClip } = await import("../lib/exportClip");
      const blob = await exportClip({
        mediaUrl,
        startTime,
        endTime,
        resolution,
        metadata: session.exportMetadata,
        onProgress: setProgress,
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${session.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}-clip.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  if (!mediaUrl) {
    return (
      <div className="min-h-screen bg-background text-foreground p-8 flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">Could not find media file for this session.</p>
          <button onClick={onBack} className="text-primary hover:underline">Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="flex items-center justify-between p-6 border-b border-border bg-card/50">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold truncate max-w-md">{session.title}</h1>
            <p className="text-sm text-muted-foreground">Edit Clip</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <select
            value={resolution}
            onChange={(event) => setResolution(event.target.value as "original" | "1080" | "720")}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
            disabled={exporting}
          >
            <option value="original">Original Quality</option>
            <option value="1080">1080p</option>
            <option value="720">720p</option>
          </select>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex w-42 items-center justify-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {exporting ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                {Math.round(progress * 100)}%
              </span>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Export MP4
              </>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-8 max-w-6xl mx-auto w-full gap-8">
        {error && (
          <div className="w-full bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="w-full aspect-video bg-background rounded-lg overflow-hidden border border-border shadow-2xl relative group">
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain"
            onClick={togglePlay}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                togglePlay();
              }}
              className={`pointer-events-auto w-16 h-16 bg-primary/90 text-primary-foreground rounded-full flex items-center justify-center backdrop-blur-sm transition-all ${playing ? "opacity-0 scale-90" : "opacity-100 scale-100 group-hover:bg-primary"}`}
            >
              <Play className="w-8 h-8 ml-1" />
            </button>
          </div>
          {loadingPreview && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">
              {previewStatus}
            </div>
          )}
        </div>

        <div className="w-full bg-card text-card-foreground border border-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-6 gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={togglePlay}
                disabled={loadingPreview}
                className="w-10 h-10 bg-secondary hover:bg-secondary/90 text-secondary-foreground disabled:opacity-50 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors"
              >
                {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>
              <div className="text-sm font-medium font-mono">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMuted((current) => !current)}
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
                  aria-label={muted || volume === 0 ? "Unmute preview" : "Mute preview"}
                >
                  {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(event) => {
                    const nextVolume = Number(event.target.value);
                    setVolume(nextVolume);
                    setMuted(nextVolume === 0);
                  }}
                  className="w-24 accent-primary"
                  aria-label="Preview volume"
                />
              </div>
              <div className="text-sm font-medium font-mono">
                Clip: {formatTime(startTime)} - {formatTime(endTime)}
              </div>
            </div>
            <div className="text-sm text-muted-foreground font-mono">
              {formatTime(endTime - startTime)}
            </div>
          </div>

          <div className="space-y-4">
            {!hasDuration && (
              <div className="bg-secondary/10 border border-secondary/20 text-secondary p-3 rounded-lg text-sm">
                Waiting for media duration from Plex before clip controls can be adjusted.
              </div>
            )}

            {hasDuration && (
              <div
                ref={timelineWheelRegionRef}
                className="cliparr-timeline"
                onWheelCapture={handleTimelineWheel}
              >
                <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>Full video</span>
                  <span className="font-mono">0:00 - {formatTime(duration)}</span>
                </div>
                <Timeline
                  ref={timelineRef}
                  editorData={timelineData}
                  effects={timelineEffects}
                  scale={activeTimelineScale.scale}
                  scaleSplitCount={activeTimelineScale.scaleSplitCount}
                  scaleWidth={activeTimelineScale.scaleWidth}
                  minScaleCount={timelineScaleCount}
                  maxScaleCount={timelineScaleCount}
                  startLeft={TIMELINE_START_LEFT}
                  rowHeight={44}
                  autoScroll
                  dragLine
                  disableDrag={loadingPreview || playing}
                  onScroll={handleTimelineScroll}
                  onChange={handleTimelineChange}
                  onActionMoving={({ start, end }) => isValidTimelineRange(start, end)}
                  onActionResizing={({ start, end }) => isValidTimelineRange(start, end)}
                  onActionMoveEnd={({ start }) => {
                    void seekToTime(start);
                  }}
                  onActionResizeEnd={({ start, end, dir }) => {
                    void seekToTime(dir === "left" ? start : end);
                  }}
                  onClickTimeArea={(time) => {
                    void seekToTime(time);
                    return false;
                  }}
                  onClickRow={(_, { time }) => {
                    void seekToTime(time);
                  }}
                  onClickActionOnly={(_, { time }) => {
                    void seekToTime(time);
                  }}
                  onCursorDragStart={() => {
                    if (playingRef.current) {
                      pausePlayback();
                    }
                  }}
                  onCursorDrag={(time) => {
                    const nextTime = clampTime(time);
                    playbackTimeAtStartRef.current = nextTime;
                    setCurrentTime(nextTime);
                  }}
                  onCursorDragEnd={(time) => {
                    void seekToTime(time);
                  }}
                  getScaleRender={formatTime}
                  getActionRender={renderClipTimelineAction}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
