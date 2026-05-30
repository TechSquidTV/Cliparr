import type { WrappedAudioBuffer } from "mediabunny";
import { fromSourceTimelineTime } from "@/lib/mediabunnyTrackAccess";

type RefValue<T> = {
  current: T;
};

interface RunPlaybackAudioIteratorOptions {
  iterator: AsyncGenerator<WrappedAudioBuffer, void, unknown> | null;
  audioContext: AudioContext | null;
  gainNode: GainNode | null;
  queuedAudioNodes: Set<AudioBufferSourceNode>;
  generation: number;
  generationRef: RefValue<number>;
  playingRef: RefValue<boolean>;
  audioContextStartTimeRef: RefValue<number | null>;
  playbackTimeAtStartRef: RefValue<number>;
  sourceTimelineOffsetRef: RefValue<number>;
  getPlaybackTime: () => number;
  onError: (err: unknown) => void;
}

export function playbackGainValue(volume: number, muted: boolean) {
  const actualVolume = muted || volume === 0 ? 0 : volume;
  return actualVolume ** 2;
}

export function applyPlaybackGain(
  gainNode: GainNode | null,
  volume: number,
  muted: boolean,
) {
  if (gainNode) {
    gainNode.gain.value = playbackGainValue(volume, muted);
  }
}

export function stopQueuedAudioNodes(
  queuedAudioNodes: Set<AudioBufferSourceNode>,
) {
  for (const node of queuedAudioNodes) {
    try {
      node.stop();
    } catch {
      // The node may have already ended.
    }
  }
  queuedAudioNodes.clear();
}

export async function runPlaybackAudioIterator({
  iterator,
  audioContext,
  gainNode,
  queuedAudioNodes,
  generation,
  generationRef,
  playingRef,
  audioContextStartTimeRef,
  playbackTimeAtStartRef,
  sourceTimelineOffsetRef,
  getPlaybackTime,
  onError,
}: RunPlaybackAudioIteratorOptions) {
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
      const displayTimestamp = fromSourceTimelineTime(
        timestamp,
        sourceTimelineOffsetRef.current,
      );

      const startTimestamp =
        (audioContextStartTimeRef.current ?? audioContext.currentTime) +
        displayTimestamp -
        playbackTimeAtStartRef.current;

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
        queuedAudioNodes.add(node);
        node.onended = () => {
          queuedAudioNodes.delete(node);
        };
      }

      if (displayTimestamp - getPlaybackTime() >= 1) {
        await waitForAudioLead({
          generation,
          generationRef,
          playingRef,
          displayTimestamp,
          getPlaybackTime,
        });
      }
    }
  } catch (err) {
    if (generation === generationRef.current) {
      onError(err);
    }
  }
}

function waitForAudioLead({
  generation,
  generationRef,
  playingRef,
  displayTimestamp,
  getPlaybackTime,
}: {
  generation: number;
  generationRef: RefValue<number>;
  playingRef: RefValue<boolean>;
  displayTimestamp: number;
  getPlaybackTime: () => number;
}) {
  return new Promise<void>((resolve) => {
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
