import type {
  AudioBufferSink,
  CanvasSink,
  Input,
  InputAudioTrack,
  InputVideoTrack,
} from "mediabunny";
import { playbackGainValue } from "@/components/editor/editorPlaybackAudio";
import { PlaybackSourceError } from "@/components/editor/editorPlaybackSources";

type RefValue<T> = {
  current: T;
};

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

interface CanvasSinkConstructor {
  new (
    track: InputVideoTrack,
    options: {
      poolSize: number;
      fit: "contain";
      alpha: boolean;
    },
  ): CanvasSink;
}

interface AudioBufferSinkConstructor {
  new (track: InputAudioTrack): AudioBufferSink;
}

interface CreatePlaybackSinkResourcesOptions {
  CanvasSinkConstructor: CanvasSinkConstructor;
  AudioBufferSinkConstructor: AudioBufferSinkConstructor;
  previewVideoTrack: InputVideoTrack | null;
  previewAudioTrack: InputAudioTrack | null;
  audioTrackSampleRate?: number;
  volume: number;
  muted: boolean;
}

interface DisposePlaybackSinkResourcesOptions {
  inputRef: RefValue<Input | null>;
  videoSinkRef: RefValue<CanvasSink | null>;
  audioSinkRef: RefValue<AudioBufferSink | null>;
  audioContextRef: RefValue<AudioContext | null>;
  gainNodeRef: RefValue<GainNode | null>;
}

export function getAudioContextConstructor() {
  return (
    window.AudioContext ??
    (window as WindowWithWebkitAudioContext).webkitAudioContext
  );
}

export async function createPlaybackSinkResources({
  CanvasSinkConstructor,
  AudioBufferSinkConstructor,
  previewVideoTrack,
  previewAudioTrack,
  audioTrackSampleRate,
  volume,
  muted,
}: CreatePlaybackSinkResourcesOptions) {
  const videoSink = previewVideoTrack
    ? new CanvasSinkConstructor(previewVideoTrack, {
        poolSize: 2,
        fit: "contain",
        alpha: await previewVideoTrack.canBeTransparent(),
      })
    : null;

  if (!previewAudioTrack) {
    return {
      videoSink,
      audioSink: null,
      audioContext: null,
      gainNode: null,
    };
  }

  const AudioContextConstructor = getAudioContextConstructor();
  if (!AudioContextConstructor) {
    throw new PlaybackSourceError(
      "preview-only",
      "This browser does not provide Web Audio.",
    );
  }

  const audioContext = new AudioContextConstructor({
    sampleRate: audioTrackSampleRate,
  });
  const gainNode = audioContext.createGain();
  gainNode.gain.value = playbackGainValue(volume, muted);
  gainNode.connect(audioContext.destination);

  return {
    videoSink,
    audioSink: new AudioBufferSinkConstructor(previewAudioTrack),
    audioContext,
    gainNode,
  };
}

export function disposePlaybackSinkResources({
  inputRef,
  videoSinkRef,
  audioSinkRef,
  audioContextRef,
  gainNodeRef,
}: DisposePlaybackSinkResourcesOptions) {
  videoSinkRef.current = null;
  audioSinkRef.current = null;
  inputRef.current?.dispose();
  inputRef.current = null;
  void audioContextRef.current?.close().catch(() => undefined);
  audioContextRef.current = null;
  gainNodeRef.current = null;
}
