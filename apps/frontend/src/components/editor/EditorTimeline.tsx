import {
  CanvasRenderer,
  Timeline,
  useTimelineTracks,
} from "@techsquidtv/canvas-timeline";
import type { EditorTimelineTrackKind } from "@/components/editor/editorTimelineEngine";
import "@techsquidtv/canvas-timeline/styles.css";

function EditorTimelineLayers() {
  const { tracks } = useTimelineTracks<EditorTimelineTrackKind>();

  return (
    <>
      <Timeline.PlayheadArea />
      <Timeline.PlayheadGrabber />
      <Timeline.TrackList className="timeline-track-list-overlay">
        {tracks.map((track) => (
          <Timeline.Track key={track.id} trackId={track.id} />
        ))}
      </Timeline.TrackList>
      <Timeline.ClipInteractionLayer />
      <Timeline.RangeSelector />
    </>
  );
}

export function EditorTimeline() {
  return (
    <div className="cliparr-timeline-v2 flex h-full min-h-0 flex-col bg-editor-panel">
      <div className="min-h-0 flex-1">
        <Timeline.Root className="h-full min-h-editor-timeline-mobile w-full lg:min-h-0">
          <CanvasRenderer />
          <EditorTimelineLayers />
        </Timeline.Root>
      </div>
      <div className="cliparr-timeline-scrollbar-row shrink-0 border-t border-editor-border px-2 py-1.5">
        <Timeline.ViewportScrollbar>
          <Timeline.ViewportScrollbarThumb>
            <Timeline.ViewportScrollbarHandle side="start" />
            <Timeline.ViewportScrollbarHandle side="end" />
          </Timeline.ViewportScrollbarThumb>
        </Timeline.ViewportScrollbar>
      </div>
    </div>
  );
}
