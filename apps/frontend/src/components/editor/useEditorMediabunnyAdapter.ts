import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createMediabunnyAdapter,
  type MediabunnyAdapter,
  type MediabunnySource,
} from "@techsquidtv/canvas-timeline-mediabunny-adapter";
import { errorMessage } from "@/components/editor/editorUtilities";

const mediaTrackKinds = ["media"] as const;
const loadMediabunny = () => import("mediabunny");
const unsubscribeFromNoFrames = () => {};
const subscribeToNoFrames = () => unsubscribeFromNoFrames;
const getNoFrameTime = () => null;

interface EditorAudioOutput {
  context: AudioContext;
  gain: GainNode;
}

interface UseEditorMediabunnyAdapterOptions {
  sources: readonly MediabunnySource[];
  muted: boolean;
  volume: number;
}

function createEditorAudioOutput(): EditorAudioOutput | null {
  if (typeof window === "undefined") {
    return null;
  }

  const AudioContextConstructor =
    window.AudioContext ??
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }

  const context = new AudioContextConstructor();
  const gain = context.createGain();
  gain.connect(context.destination);
  return { context, gain };
}

/*
 Couples Cliparr's gain node to the installed v0.1.0 adapter lifecycle.
 That adapter closes caller-owned audio contexts, and its clock-resume promise
 can remain pending. The packaged hook therefore cannot preserve audio across
 source refreshes while allowing video to continue when activation stalls.
*/
export function useEditorMediabunnyAdapter({
  sources,
  muted,
  volume,
}: UseEditorMediabunnyAdapterOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [adapter, setAdapter] = useState<MediabunnyAdapter | null>(null);
  const [audioOutput, setAudioOutput] = useState<EditorAudioOutput | null>(
    null,
  );
  const [audioResumeWarning, setAudioResumeWarning] = useState("");
  const [, forceAdapterUpdate] = useReducer((value: number) => value + 1, 0);
  const volumeReference = useRef(volume);
  const mutedReference = useRef(muted);
  const currentAdapterReference = useRef<MediabunnyAdapter | null>(null);
  volumeReference.current = volume;
  mutedReference.current = muted;

  useEffect(() => {
    const output = createEditorAudioOutput();
    if (output) {
      output.gain.gain.value = mutedReference.current
        ? 0
        : volumeReference.current;
    }
    const nextAdapter = createMediabunnyAdapter({
      audio: output
        ? {
            context: output.context,
            destination: output.gain,
            volume: 1,
          }
        : { volume: mutedReference.current ? 0 : volumeReference.current },
      audioTrackKinds: mediaTrackKinds,
      mediabunny: loadMediabunny,
      sources,
      visualTrackKinds: mediaTrackKinds,
      onChange: forceAdapterUpdate,
    });
    nextAdapter.setCanvas(canvasRef.current);
    setAudioOutput(output);
    setAdapter(nextAdapter);

    return () => {
      nextAdapter.dispose();
      if (output && output.context.state !== "closed") {
        void output.context.close().catch(() => {});
      }
    };
  }, [sources]);

  useEffect(() => {
    adapter?.setCanvas(canvasRef.current);
  }, [adapter]);

  useEffect(() => {
    if (audioOutput) {
      audioOutput.gain.gain.value = muted ? 0 : volume;
    }
  }, [audioOutput, muted, volume]);

  useEffect(() => {
    currentAdapterReference.current = adapter;
    setAudioResumeWarning("");
  }, [adapter]);

  const syncAdapter = useMemo(
    () =>
      adapter
        ? {
            ...adapter.syncAdapter,
            resumeClock: (playbackRate: number) => {
              setAudioResumeWarning("");
              void adapter.resumeClock(playbackRate).catch((error) => {
                if (currentAdapterReference.current !== adapter) {
                  return;
                }
                setAudioResumeWarning(
                  `Audio preview could not resume. Video playback will continue without audio: ${errorMessage(error)}`,
                );
              });
            },
          }
        : {
            getClockTime: (): number => 0,
            startClock: () => false,
          },
    [adapter],
  );
  const renderedFrameTime = useSyncExternalStore(
    adapter?.subscribeFrame ?? subscribeToNoFrames,
    adapter ? () => adapter.lastFrameTime : getNoFrameTime,
    getNoFrameTime,
  );

  return {
    adapter,
    audioResumeWarning,
    canvasRef,
    renderedFrameTime,
    syncAdapter,
  };
}
