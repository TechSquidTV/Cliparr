import {
  CanvasRenderer,
  Timeline,
  toSeconds,
  useTimelinePlayback,
  useTimelineTracks,
  useTimelineViewport,
  type UseTimelineTrackHeaderResult,
} from "@techsquidtv/canvas-timeline";
import { Eye, EyeOff, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  EDITOR_MEDIA_TRACK_ID,
  timelineScrollLeftForCenteredTime,
} from "@/components/editor/editorTimelineEngine";
import "@techsquidtv/canvas-timeline/styles.css";

interface EditorTimelineProperties {
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
}

function TrackHeaderColumn({ muted, onMutedChange }: EditorTimelineProperties) {
  const { tracks } = useTimelineTracks();

  return (
    <Timeline.TrackHeaderList className="h-full">
      {tracks.map((track) => (
        <Timeline.TrackHeader key={track.id} trackId={track.id}>
          {(header: UseTimelineTrackHeaderResult) => (
            <div className="flex h-full min-w-0 flex-1 items-center gap-2">
              {track.id === EDITOR_MEDIA_TRACK_ID ? (
                <button
                  type="button"
                  onClick={() => onMutedChange(!muted)}
                  title={muted ? "Unmute Source" : "Mute Source"}
                  aria-label={muted ? "Unmute Source" : "Mute Source"}
                  aria-pressed={muted}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-editor-border bg-editor-control text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none"
                >
                  {muted ? (
                    <VolumeX aria-hidden="true" className="h-3.5 w-3.5" />
                  ) : (
                    <Volume2 aria-hidden="true" className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => header.setVisible(!header.visible)}
                  title={header.visible ? "Hide Sub 1" : "Show Sub 1"}
                  aria-label={header.visible ? "Hide Sub 1" : "Show Sub 1"}
                  aria-pressed={!header.visible}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-editor-border bg-editor-control text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none"
                >
                  {header.visible ? (
                    <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                  ) : (
                    <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {header.label}
              </span>
              <Timeline.TrackHeaderResizeHandle
                trackId={track.id}
                maxHeight={96}
              />
            </div>
          )}
        </Timeline.TrackHeader>
      ))}
    </Timeline.TrackHeaderList>
  );
}

function EditorTimelineLayers() {
  const { tracks } = useTimelineTracks();

  return (
    <>
      <CenterViewportOnInPoint />
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

function CenterViewportOnInPoint() {
  const { inPoint } = useTimelinePlayback();
  const { maxScrollLeft, setScrollLeft, viewportWidth, zoomScale } =
    useTimelineViewport();
  const hasCentered = useRef(false);
  const inPointSeconds = inPoint ? toSeconds(inPoint) : undefined;

  useEffect(() => {
    if (
      hasCentered.current ||
      inPointSeconds === undefined ||
      viewportWidth <= 0
    ) {
      return;
    }

    hasCentered.current = true;
    setScrollLeft(
      timelineScrollLeftForCenteredTime({
        maxScrollLeft,
        timeSeconds: inPointSeconds,
        viewportWidth,
        zoomScale,
      }),
    );
  }, [inPointSeconds, maxScrollLeft, setScrollLeft, viewportWidth, zoomScale]);

  return null;
}

export function EditorTimeline({
  muted,
  onMutedChange,
}: EditorTimelineProperties) {
  return (
    <div className="cliparr-timeline-v2 flex h-full min-h-0 flex-col bg-editor-panel">
      <div className="flex min-h-0 flex-1">
        <div className="w-32 shrink-0 border-r border-editor-border bg-editor-panel-muted/55">
          <TrackHeaderColumn muted={muted} onMutedChange={onMutedChange} />
        </div>
        <div className="min-w-0 flex-1">
          <Timeline.Root className="h-full min-h-editor-timeline-mobile w-full lg:min-h-0">
            <CanvasRenderer />
            <EditorTimelineLayers />
          </Timeline.Root>
        </div>
      </div>
      <div className="flex shrink-0">
        <div className="w-32 shrink-0 border-t border-r border-editor-border bg-editor-panel-muted/55" />
        <div className="cliparr-timeline-scrollbar-row min-w-0 flex-1 border-t border-editor-border px-2 py-1.5">
          <Timeline.ViewportScrollbar>
            <Timeline.ViewportScrollbarThumb>
              <Timeline.ViewportScrollbarHandle side="start" />
              <Timeline.ViewportScrollbarHandle side="end" />
            </Timeline.ViewportScrollbarThumb>
          </Timeline.ViewportScrollbar>
        </div>
      </div>
    </div>
  );
}
