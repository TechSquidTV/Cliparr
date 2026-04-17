import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioBufferSink, CanvasSink, Input, WrappedAudioBuffer, WrappedCanvas } from "mediabunny";
import { ensureMediabunnyCodecs } from "../../lib/mediabunnyCodecs";
import { errorMessage, isAc3FamilyCodec, themeValue } from "./EditorUtils";

interface UseEditorPlaybackProps {
  mediaUrl: string;
  initialDuration: number;
  startTime: number;
  endTime: number;
  sessionId: string;
}

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function getAudioContextConstructor() {
  return window.AudioContext ?? (window as WindowWithWebkitAudioContext).webkitAudioContext;
}

export function useEditorPlayback({
  mediaUrl,
  initialDuration,
  startTime,
  endTime,
  sessionId,
}: UseEditorPlaybackProps) {
  const [duration, setDuration] = useState(() => Math.max(initialDuration, 0));
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewStatus, setPreviewStatus] = useState("Loading preview...");
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
  const playingRef = useRef(false);
  const audioContextStartTimeRef = useRef<number | null>(null);
  const playbackTimeAtStartRef = useRef(0);
  
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
    context.fillStyle = themeValue("--background", "oklch(0.1591 0 0)");
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = themeValue("--muted-foreground", "oklch(0.6268 0 0)");
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
      drawPlaceholder("Audio preview");
      return;
    }

    videoFrameIteratorRef.current = videoSink.canvases(getPlaybackTime());
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
    if (nextFrame && nextFrame.timestamp <= playbackTime) {
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

  const disposePreview = useCallback(() => {
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
  }, [pausePlayback, stopRenderLoop]);

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
                generation !== generationRef.current ||
                !playingRef.current ||
                timestamp - getPlaybackTime() < 1
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
      audioBufferIteratorRef.current = audioSinkRef.current.buffers(getPlaybackTime());
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

  useEffect(() => {
    if (!mediaUrl) {
      return;
    }

    let cancelled = false;
    disposePreview();
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

        const nextDuration = computedDuration > 0 ? computedDuration : Math.max(initialDuration, 0);
        setDuration(nextDuration);
        durationRef.current = nextDuration;
        setCurrentTime(0);
        playbackTimeAtStartRef.current = 0;

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
          const AudioContextConstructor = getAudioContextConstructor();
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

        await startVideoIterator();
        startRenderLoop();
      } catch (err) {
        if (!cancelled) {
          disposePreview();
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
      disposePreview();
    };
  }, [mediaUrl, initialDuration, sessionId, disposePreview, startRenderLoop, startVideoIterator]);

  return {
    canvasRef,
    currentTime,
    duration,
    playing,
    loadingPreview,
    previewStatus,
    error,
    volume,
    muted,
    setVolume,
    setMuted,
    togglePlay,
    pausePlayback,
    seekToTime,
    setCurrentTime,
    playbackTimeAtStartRef,
  };
}
