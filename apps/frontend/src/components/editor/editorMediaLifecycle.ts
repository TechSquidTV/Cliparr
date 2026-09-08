import type {
  MediabunnyAdapter,
  MediabunnySourceState,
} from "@techsquidtv/canvas-timeline-mediabunny-adapter";
import type { PlaybackSourceCandidate } from "@/components/editor/editorPlaybackSources";
import type { MediaDimensions } from "@/lib/editorMedia";

export interface EditorMediaMetadata {
  duration: number;
  frameStepSeconds: number;
  previewVideoDimensions: MediaDimensions | null;
  sourceVideoDimensions: MediaDimensions | null;
  timelineOffsetSeconds: number;
}

export interface EditorExportMedia {
  candidate: PlaybackSourceCandidate;
  metadata: EditorMediaMetadata;
}

export function editorPreviewFrameTime(
  sourceTime: number | null,
  timelineOffsetSeconds: number,
  duration: number,
): number | null {
  if (sourceTime === null) {
    return null;
  }
  const time = sourceTime - timelineOffsetSeconds;
  // An adapter can still expose its previous frame while a replacement source
  // with a different timestamp origin becomes ready. Do not export that frame
  // or use its timestamp for subtitle positioning.
  return Number.isFinite(time) && time >= 0 && time <= duration ? time : null;
}

// Preview recovery may change the decoder input, but not the export source or
// its duration/dimensions. Only a new source configuration resets this choice.
export function resolveEditorExportMedia(
  previous: EditorExportMedia | null,
  sourceState: MediabunnySourceState | undefined,
  candidates: readonly PlaybackSourceCandidate[],
  preparedInputs: ReadonlyMap<number, EditorMediaMetadata>,
): EditorExportMedia | null {
  if (previous) {
    return previous;
  }
  const firstReady = sourceState?.attempts.find(
    (attempt) => attempt.status === "ready",
  );
  if (!firstReady) {
    return null;
  }
  const candidate = candidates[firstReady.inputIndex];
  const metadata = preparedInputs.get(firstReady.inputIndex);
  return candidate && metadata ? { candidate, metadata } : null;
}

// Coalesce explicit retries and initial preload, including when the playhead
// is outside active content. Never retry automatically on a failure event.
export function createEditorPreviewSourceLoader(
  adapter: Pick<
    MediabunnyAdapter,
    "sourceStateById" | "preloadSource" | "retrySource"
  >,
  sourceId: string,
) {
  let pending: ReturnType<MediabunnyAdapter["preloadSource"]> | null = null;
  return () => {
    if (pending) {
      return pending;
    }
    const load =
      adapter.sourceStateById.get(sourceId)?.status === "failed"
        ? adapter.retrySource(sourceId)
        : adapter.preloadSource(sourceId);
    pending = load.finally(() => {
      pending = null;
    });
    return pending;
  };
}
