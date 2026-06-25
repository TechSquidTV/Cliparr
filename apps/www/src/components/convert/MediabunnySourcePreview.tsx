import { Pause, Play } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  assessVideoTrackDecodability,
  createCliparrInputFromSource,
  videoTrackPreviewUnavailableMessage,
  type EditorFileMediaSource,
} from "@cliparr/frontend/convert";
import type {
  CanvasSink as MediabunnyCanvasSink,
  InputVideoTrack,
} from "mediabunny";
import {
  formatDuration,
  type SourceProbeResult,
} from "@/components/convert/convertToolUtilities";

interface MediabunnySourcePreviewProperties {
  source: EditorFileMediaSource;
  sourceKey: string;
  probe: SourceProbeResult;
  canSelectFile: boolean;
  dragActive: boolean;
  onDragActiveChange: (active: boolean) => void;
  onDropFile: (file: File | null | undefined) => void;
}

type PreviewState =
  | { status: "loading" }
  | {
      status: "ready";
      durationSeconds: number;
      dimensions: { width: number; height: number };
    }
  | { status: "error"; message: string };

interface PreviewVideoTrackFilter {
  hasOnlyKeyPackets: () => Promise<boolean>;
}

function previewErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Could not preview this file.";
}

function clampTime(seconds: number, durationSeconds: number) {
  if (!Number.isFinite(seconds)) {
    return 0;
  }

  return Math.max(0, Math.min(seconds, durationSeconds));
}

export function MediabunnySourcePreview({
  source,
  sourceKey,
  probe,
  canSelectFile,
  dragActive,
  onDragActiveChange,
  onDropFile,
}: MediabunnySourcePreviewProperties) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<Awaited<
    ReturnType<typeof createCliparrInputFromSource>
  > | null>(null);
  const sinkRef = useRef<MediabunnyCanvasSink | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const loadTokenRef = useRef(0);
  const startTimestampRef = useRef(0);
  const durationRef = useRef(0);
  const playbackStartTimeRef = useRef(0);
  const playbackStartedAtRef = useRef(0);
  const playingRef = useRef(false);
  const renderInFlightRef = useRef(false);
  const lastRenderRequestRef = useRef(0);
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const stopPlayback = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const renderFrameAt = useCallback(async (seconds: number, token?: number) => {
    const activeToken = token ?? loadTokenRef.current;
    const sink = sinkRef.current;
    const canvas = canvasRef.current;
    const durationSeconds = durationRef.current;

    if (!sink || !canvas || durationSeconds <= 0) {
      return;
    }

    const clampedSeconds = clampTime(seconds, durationSeconds);
    const wrappedCanvas = await sink.getCanvas(
      startTimestampRef.current + clampedSeconds,
    );

    if (
      activeToken !== loadTokenRef.current ||
      !wrappedCanvas ||
      !canvasRef.current
    ) {
      return;
    }

    const context = canvasRef.current.getContext("2d");
    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    context.drawImage(
      wrappedCanvas.canvas,
      0,
      0,
      canvasRef.current.width,
      canvasRef.current.height,
    );
    setCurrentTime(clampedSeconds);
  }, []);

  const schedulePlayback = useCallback(() => {
    const tick = () => {
      if (!playingRef.current) {
        return;
      }

      const durationSeconds = durationRef.current;
      const elapsedSeconds =
        (window.performance.now() - playbackStartedAtRef.current) / 1000;
      const nextTime = clampTime(
        playbackStartTimeRef.current + elapsedSeconds,
        durationSeconds,
      );

      setCurrentTime(nextTime);

      if (nextTime >= durationSeconds) {
        stopPlayback();
        void renderFrameAt(durationSeconds);
        return;
      }

      const now = window.performance.now();
      if (
        !renderInFlightRef.current &&
        now - lastRenderRequestRef.current >= 50
      ) {
        renderInFlightRef.current = true;
        lastRenderRequestRef.current = now;
        void renderFrameAt(nextTime).finally(() => {
          renderInFlightRef.current = false;
        });
      }

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
  }, [renderFrameAt, stopPlayback]);

  useEffect(() => {
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    stopPlayback();
    setCurrentTime(0);
    setState({ status: "loading" });

    let cancelled = false;
    let input: Awaited<ReturnType<typeof createCliparrInputFromSource>> | null =
      null;
    const isStale = () => cancelled || token !== loadTokenRef.current;
    const releaseInput = () => {
      input?.dispose();
      if (inputRef.current === input) {
        inputRef.current = null;
      }
      input = null;
      sinkRef.current = null;
    };

    async function loadPreview() {
      try {
        const { CanvasSink } = await import("mediabunny");
        if (isStale()) {
          return;
        }

        input = await createCliparrInputFromSource(source);
        if (isStale()) {
          releaseInput();
          return;
        }

        inputRef.current = input;

        const videoTrack = (await input.getPrimaryVideoTrack({
          filter: async (track: PreviewVideoTrackFilter) =>
            !(await track.hasOnlyKeyPackets()),
        })) as InputVideoTrack | null;
        if (isStale()) {
          releaseInput();
          return;
        }

        if (!videoTrack) {
          throw new Error(
            "This file does not contain a previewable video track.",
          );
        }

        const decodability = await assessVideoTrackDecodability(videoTrack);
        if (decodability.codec === null || !decodability.canDecode) {
          throw new Error(videoTrackPreviewUnavailableMessage(decodability));
        }
        if (isStale()) {
          releaseInput();
          return;
        }

        const durationSeconds = probe.durationSeconds;
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          throw new Error("Could not determine this file's preview duration.");
        }

        const dimensions = probe.dimensions;
        const canvas = canvasRef.current;
        if (isStale()) {
          releaseInput();
          return;
        }
        if (!canvas) {
          throw new Error("Could not initialize the preview canvas.");
        }

        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        startTimestampRef.current = probe.previewStartTimestampSeconds;
        durationRef.current = durationSeconds;
        const alpha = await videoTrack.canBeTransparent();
        if (isStale()) {
          releaseInput();
          return;
        }

        sinkRef.current = new CanvasSink(videoTrack, {
          alpha,
          fit: "contain",
          poolSize: 2,
        });

        if (isStale()) {
          releaseInput();
          return;
        }

        setState({ status: "ready", durationSeconds, dimensions });
        await renderFrameAt(0, token);
      } catch (error) {
        releaseInput();
        if (!isStale()) {
          setState({ status: "error", message: previewErrorMessage(error) });
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
      loadTokenRef.current++;
      stopPlayback();
      releaseInput();
    };
  }, [probe, renderFrameAt, source, sourceKey, stopPlayback]);

  const handleTogglePlayback = useCallback(() => {
    if (state.status !== "ready") {
      return;
    }

    if (playingRef.current) {
      playbackStartTimeRef.current = currentTime;
      stopPlayback();
      return;
    }

    const startTime =
      currentTime >= state.durationSeconds
        ? 0
        : clampTime(currentTime, state.durationSeconds);
    playbackStartTimeRef.current = startTime;
    playbackStartedAtRef.current = window.performance.now();
    playingRef.current = true;
    setPlaying(true);
    schedulePlayback();
  }, [currentTime, schedulePlayback, state, stopPlayback]);

  const handleSeek = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (state.status !== "ready") {
        return;
      }

      const nextTime = clampTime(
        Number(event.currentTarget.value),
        state.durationSeconds,
      );
      stopPlayback();
      playbackStartTimeRef.current = nextTime;
      setCurrentTime(nextTime);
      void renderFrameAt(nextTime);
    },
    [renderFrameAt, state, stopPlayback],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      onDragActiveChange(false);
      if (canSelectFile) {
        onDropFile(event.dataTransfer.files.item(0));
      }
    },
    [canSelectFile, onDragActiveChange, onDropFile],
  );

  const durationSeconds = state.status === "ready" ? state.durationSeconds : 0;

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (canSelectFile) {
          onDragActiveChange(true);
        }
      }}
      onDragLeave={() => onDragActiveChange(false)}
      onDrop={handleDrop}
      className={`mt-4 overflow-hidden rounded-lg border border-border bg-background transition-colors ${
        dragActive ? "border-secondary bg-secondary/10" : ""
      }`}
    >
      <button
        type="button"
        onClick={handleTogglePlayback}
        disabled={state.status !== "ready"}
        aria-label={playing ? "Pause preview" : "Play preview"}
        className="group relative block aspect-video w-full overflow-hidden bg-black text-left disabled:cursor-wait"
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full object-contain"
          aria-hidden="true"
        />

        {state.status === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm font-medium text-white">
            Loading preview
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4 text-center text-sm font-medium text-white">
            {state.message}
          </div>
        ) : null}

        {state.status === "ready" ? (
          <span className="absolute left-1/2 top-1/2 inline-flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white opacity-90 transition-opacity group-hover:opacity-100">
            {playing ? (
              <Pause className="h-6 w-6" />
            ) : (
              <Play className="h-6 w-6 translate-x-0.5" />
            )}
          </span>
        ) : null}
      </button>

      <div className="grid gap-3 border-t border-border bg-card p-3">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="truncate font-medium text-foreground">
            {source.file.name}
          </span>
          <span className="shrink-0 font-mono tabular-nums">
            {formatDuration(currentTime)} / {formatDuration(durationSeconds)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={durationSeconds || 0}
          step={0.01}
          value={Math.min(currentTime, durationSeconds)}
          disabled={state.status !== "ready"}
          onChange={handleSeek}
          aria-label="Preview position"
          className="h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
    </div>
  );
}
