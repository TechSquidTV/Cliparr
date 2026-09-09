import {
  CanvasRenderer,
  Timeline,
  toSeconds,
  useTimelinePlayback,
  useTimelineTracks,
  useTimelineViewport,
  type TimelineEngine,
  type UseTimelineTrackHeaderResult,
} from "@techsquidtv/canvas-timeline";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EditorMediaRange } from "@/components/editor/EditorMediaRange";
import { EditorMediaRangeCanvas } from "@/components/editor/EditorMediaRangeCanvas";
import { EditorViewportScrollbar } from "@/components/editor/EditorViewportScrollbar";
import { handleHorizontalScrollKeyDown } from "@/components/ui/scroll-area";
import { zoomEditorTimeline } from "@/components/editor/editorTimelineZoom";
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
                  title={muted ? "Unmute preview" : "Mute preview"}
                  aria-label={muted ? "Unmute preview" : "Mute preview"}
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

function EditorTimelineLayers({
  engine,
  ready,
}: {
  engine: TimelineEngine;
  ready: boolean;
}) {
  const { tracks } = useTimelineTracks();

  return (
    <>
      {ready && <CenterViewportOnInPoint />}
      <Timeline.PlayheadArea />
      <Timeline.PlayheadGrabber />
      <Timeline.TrackList className="timeline-track-list-overlay">
        {tracks.map((track) => (
          <Timeline.Track key={track.id} trackId={track.id} />
        ))}
      </Timeline.TrackList>
      <Timeline.ClipInteractionLayer />
      <EditorMediaRange engine={engine} />
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
  engine,
  ready,
  muted,
  onMutedChange,
}: EditorTimelineProperties & { engine: TimelineEngine; ready: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const horizontalScroller = useRef<HTMLDivElement>(null);
  const trackHeader = useRef<HTMLDivElement>(null);
  const [trackNamesVisible, setTrackNamesVisible] = useState(true);
  useEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }
    const zoomAtPointer = (event: WheelEvent) => {
      if (event.shiftKey || (!event.ctrlKey && !event.metaKey)) {
        return;
      }
      // Intercept before the library's wheel listener, which preserves pixel
      // scroll offset and can jump far from the current moment on long media.
      event.preventDefault();
      event.stopPropagation();
      zoomEditorTimeline(
        engine,
        Math.max(0.01, engine.zoomScale * (1 - event.deltaY * 0.001)),
        event.clientX - element.getBoundingClientRect().left,
      );
    };
    element.addEventListener("wheel", zoomAtPointer, {
      capture: true,
      passive: false,
    });
    return () => element.removeEventListener("wheel", zoomAtPointer, true);
  }, [engine]);

  return (
    <div className="flex h-full min-h-0 flex-col [--editor-track-header-width:6rem] lg:[--editor-track-header-width:8rem]">
      <div
        ref={horizontalScroller}
        role="region"
        aria-label="Timeline tracks and names"
        tabIndex={0}
        className="cliparr-editor-scrollbar min-h-0 flex-1 overflow-x-auto overscroll-x-contain lg:overflow-x-hidden"
        onScroll={(event) =>
          setTrackNamesVisible(
            event.currentTarget.scrollLeft <
              (trackHeader.current?.offsetWidth ?? 0) - 1,
          )
        }
        onKeyDown={handleHorizontalScrollKeyDown}
      >
        <div className="cliparr-timeline-v2 flex h-full min-h-0 w-[calc(100%+var(--editor-track-header-width))] flex-col bg-editor-panel lg:w-full">
          <div className="flex min-h-0 flex-1">
            <div
              ref={trackHeader}
              className="w-[var(--editor-track-header-width)] shrink-0 border-r border-editor-border bg-editor-panel-muted/55"
            >
              <TrackHeaderColumn muted={muted} onMutedChange={onMutedChange} />
            </div>
            <div className="min-w-0 flex-1">
              <Timeline.Root ref={root} className="h-full w-full">
                <CanvasRenderer showInOutPoints={false} />
                <EditorMediaRangeCanvas />
                <EditorTimelineLayers engine={engine} ready={ready} />
              </Timeline.Root>
            </div>
          </div>
          <div className="flex shrink-0">
            <div className="w-[var(--editor-track-header-width)] shrink-0 border-t border-r border-editor-border bg-editor-panel-muted/55" />
            <div className="cliparr-timeline-scrollbar-row min-w-0 flex-1 border-t border-editor-border px-2 py-1.5">
              <EditorViewportScrollbar />
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="flex min-h-11 shrink-0 items-center justify-center gap-2 border-t border-editor-border bg-editor-panel px-3 text-xs text-muted-foreground hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-editor-accent/35 focus-visible:outline-none lg:hidden"
        onClick={() =>
          horizontalScroller.current?.scrollTo({
            left: trackNamesVisible
              ? (trackHeader.current?.offsetWidth ?? 0)
              : 0,
          })
        }
      >
        {trackNamesVisible ? (
          <ChevronLeft className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        {trackNamesVisible ? "Hide track names" : "Show track names"}
      </button>
    </div>
  );
}
