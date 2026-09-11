import { useEffect, useRef } from "react";
import {
  fromSeconds,
  toSeconds,
  type TimelineEngine,
} from "@techsquidtv/canvas-timeline";
import type { AssetCaptureController } from "@cliparr/shared/asset-capture";
import type { useEditorTimelineMedia } from "@/components/editor/useEditorTimelineMedia";
import type { useEditorSubtitles } from "@/components/editor/useEditorSubtitles";
import { subtitleTrackKey } from "@/lib/selectPreferredSubtitleTrack";
import { zoomEditorTimeline } from "@/components/editor/editorTimelineZoom";

type CaptureSubtitles = Pick<
  ReturnType<typeof useEditorSubtitles>,
  | "subtitleTracks"
  | "subtitleOutputEnabled"
  | "subtitleCuesReady"
  | "subtitleLoading"
  | "subtitleError"
  | "clippedSubtitleCues"
  | "setSubtitleEnabled"
  | "setSubtitleStyleSettings"
  | "handleSelectedSubtitleTrackChange"
>;

interface CaptureBindings {
  engine: TimelineEngine;
  media: ReturnType<typeof useEditorTimelineMedia>;
  subtitles: CaptureSubtitles;
  fitSelection: () => void;
}

export function useEditorAssetCapture(bindings: CaptureBindings) {
  const current = useRef(bindings);
  useEffect(() => {
    current.current = bindings;
  });
  useEffect(() => {
    // Vite removes this bridge from normal builds. Never enable it in deployment.
    if (import.meta.env.VITE_CLIPARR_ASSET_CAPTURE !== "true") {
      return;
    }
    const controller: AssetCaptureController = {
      inspect() {
        const { engine, media, subtitles } = current.current;
        const state = engine.getState();
        return {
          mediaReady: media.metadataReady,
          previewReady:
            !media.loadingPreview &&
            !media.loadingPreviewFrame &&
            media.renderedFrameTime !== null,
          duration: media.duration,
          inSeconds: state.inPoint ? toSeconds(state.inPoint) : 0,
          outSeconds: state.outPoint
            ? toSeconds(state.outPoint)
            : media.duration,
          currentSeconds: media.getPlaybackTime(),
          renderedSeconds: media.renderedFrameTime,
          frameStepSeconds: media.frameStepSeconds,
          playing: media.playing,
          subtitlesReady:
            subtitles.subtitleOutputEnabled &&
            subtitles.subtitleCuesReady &&
            !subtitles.subtitleLoading,
          subtitleCueCount: subtitles.clippedSubtitleCues.length,
          subtitleTracks: subtitles.subtitleTracks.map((track) => ({
            key: subtitleTrackKey(track),
            title: track.title ?? track.languageCode ?? "Subtitle",
          })),
          error: media.error || subtitles.subtitleError || "",
        };
      },
      configure({
        inSeconds,
        outSeconds,
        subtitleTrackKey: trackKey,
        subtitleFontSize,
      }) {
        const { engine, media, subtitles } = current.current;
        if (
          !media.metadataReady ||
          !Number.isFinite(inSeconds) ||
          !Number.isFinite(outSeconds) ||
          inSeconds < 0 ||
          outSeconds <= inSeconds ||
          outSeconds > media.duration
        ) {
          throw new Error(
            "Capture selection is outside the loaded media duration.",
          );
        }
        if (
          subtitleFontSize !== undefined &&
          (!Number.isFinite(subtitleFontSize) ||
            subtitleFontSize < 16 ||
            subtitleFontSize > 150)
        ) {
          throw new Error("Capture subtitle font size must be from 16 to 150.");
        }
        if (
          trackKey &&
          !subtitles.subtitleTracks.some(
            (track) => subtitleTrackKey(track) === trackKey,
          )
        ) {
          throw new Error("Requested capture subtitle track is unavailable.");
        }
        if (subtitles.subtitleTracks.length === 0) {
          throw new Error("Capture requires a supported text subtitle track.");
        }
        media.pausePlayback();
        const result = engine.setInOutRange(
          fromSeconds(inSeconds),
          fromSeconds(outSeconds),
        );
        if (!result.ok) {
          throw new Error("Timeline rejected the capture selection.");
        }
        if (trackKey) {
          subtitles.handleSelectedSubtitleTrackChange(trackKey);
        }
        if (subtitleFontSize !== undefined) {
          subtitles.setSubtitleStyleSettings((settings) => ({
            ...settings,
            fontSize: subtitleFontSize,
          }));
        }
        subtitles.setSubtitleEnabled(true);
        media.seekToTime(inSeconds);
      },
      fitSelection() {
        const { engine, fitSelection } = current.current;
        fitSelection();
        // Show source context on both sides so the selection reads as a clip.
        zoomEditorTimeline(
          engine,
          engine.zoomScale * 0.65,
          (engine.getState().viewportWidth ?? 0) / 2,
        );
      },
      async play() {
        const { media } = current.current;
        if (!media.playing) {
          await media.togglePlay();
        }
      },
      pause: () => current.current.media.pausePlayback(),
    };
    window.cliparrAssetCapture = controller;
    return () => {
      if (window.cliparrAssetCapture === controller) {
        delete window.cliparrAssetCapture;
      }
    };
  }, []);
}
