import { useEffect, useRef, useState } from "react";
import type {
  audioBitDepthSummary,
  AudioSourceInfo,
  ExportAudioPlan,
} from "#/lib/export/exportAudio";
import { createCliparrInputFromSource } from "#/lib/export/mediabunny/mediabunnyInput";
import { isPlaybackVideoTrack } from "#/lib/export/mediabunny/mediabunnyTrackAccess";
import { selectPreferredPairableAudioTrack } from "#/lib/subtitles/selectPreferredAudioTrack";
import {
  editorMediaSourcesEqual,
  type EditorMediaSource,
} from "#/components/editor/editorMedia";
import type { PlaybackAudioSelection } from "#/providers/types";
import {
  isAudioExportFormat,
  type ExportFormat,
} from "#/lib/export/exportFormats";

type AudioInspection = {
  source: EditorMediaSource;
  selection: string;
  audio: AudioSourceInfo | null;
};

export function useExportAudioPlan(
  source: EditorMediaSource | null,
  selectedTrack: PlaybackAudioSelection | undefined,
  format: ExportFormat,
  mixdown: boolean,
  active: boolean,
) {
  const cache = useRef<AudioInspection[]>([]);
  const selection = JSON.stringify(selectedTrack ?? {});
  const [result, setResult] = useState<{
    source: EditorMediaSource;
    selection: string;
    format: ExportFormat;
    mixdown: boolean;
    plan: ExportAudioPlan | null;
    bitDepth: ReturnType<typeof audioBitDepthSummary>;
    error: string | null;
    channels: number | null;
  } | null>(null);
  useEffect(() => {
    if (!active || !source || format === "gif") {
      return;
    }
    const controller = new AbortController();
    let input:
      Awaited<ReturnType<typeof createCliparrInputFromSource>> | undefined;
    const dispose = () => input?.dispose();
    controller.signal.addEventListener("abort", dispose, { once: true });
    void (async () => {
      const {
        inspectAudioTrack,
        resolveExportAudioPlan,
        audioBitDepthSummary,
      } = await import("#/lib/export/exportAudio");
      controller.signal.throwIfAborted();
      let inspection = cache.current.find(
        (entry) =>
          editorMediaSourcesEqual(entry.source, source) &&
          entry.selection === selection,
      );
      if (!inspection) {
        input = await createCliparrInputFromSource(source);
        controller.signal.throwIfAborted();
        const video = await input.getPrimaryVideoTrack({
          filter: isPlaybackVideoTrack,
        });
        const tracks = await input.getAudioTracks();
        const track = await selectPreferredPairableAudioTrack(
          video,
          tracks,
          selectedTrack,
        );
        inspection = {
          source,
          selection,
          audio: track
            ? await inspectAudioTrack(track, controller.signal)
            : null,
        };
        controller.signal.throwIfAborted();
        cache.current = [inspection, ...cache.current].slice(0, 4);
      }
      const plan = inspection.audio
        ? await resolveExportAudioPlan(inspection.audio, format, mixdown)
        : null;
      if (!controller.signal.aborted) {
        setResult({
          source,
          selection,
          format,
          mixdown,
          plan,
          bitDepth: plan ? audioBitDepthSummary(plan) : null,
          error: null,
          channels: inspection.audio?.numberOfChannels ?? 0,
        });
      }
    })()
      .catch((error: Error) => {
        if (!controller.signal.aborted) {
          const inspection = cache.current.find(
            (entry) =>
              editorMediaSourcesEqual(entry.source, source) &&
              entry.selection === selection,
          );
          setResult({
            source,
            selection,
            format,
            mixdown,
            plan: null,
            bitDepth: null,
            error: error.message,
            channels: inspection?.audio?.numberOfChannels ?? null,
          });
        }
      })
      .finally(() => {
        controller.signal.removeEventListener("abort", dispose);
        dispose();
      });
    return () => controller.abort();
  }, [active, source, selectedTrack, selection, format, mixdown]);
  const current =
    source &&
    result &&
    editorMediaSourcesEqual(result.source, source) &&
    result.selection === selection &&
    result.format === format &&
    result.mixdown === mixdown
      ? result
      : null;
  let status = "Not included";
  if (active) {
    status = current?.error ? "Unavailable" : "Checking source audio…";
    if (current?.channels === 0) {
      status = "No source audio";
    }
    if (current?.plan) {
      status = "Ready";
    }
  }
  let disabledReason: string | null = null;
  if (active) {
    disabledReason = "Checking audio export support…";
    if (current) {
      disabledReason = current.error;
      if (
        !disabledReason &&
        current.channels === 0 &&
        isAudioExportFormat(format)
      ) {
        disabledReason = "The selected source has no audio track.";
      }
    }
  }
  const channels = current?.channels ?? null;
  let mixdownDisabledReason: string | null = null;
  if (channels === 0) {
    mixdownDisabledReason = "The source has no audio track.";
  } else if (channels !== null && channels <= 2) {
    mixdownDisabledReason = "The source is already mono or stereo.";
  }
  return {
    plan: active ? (current?.plan ?? null) : null,
    bitDepth: active ? (current?.bitDepth ?? null) : null,
    mixdownDisabledReason,
    disabledReason,
    status,
  };
}
