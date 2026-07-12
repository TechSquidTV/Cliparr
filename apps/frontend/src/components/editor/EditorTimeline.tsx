import {
  CanvasRenderer,
  Timeline,
  defaultTimelineInteractionGeometry,
  toSeconds,
  useTimelineTracks,
  useTimeline,
  type ClipHitRegion,
  type TimelineEditCommand,
  type UseTimelineTrackHeaderResult,
} from "@techsquidtv/canvas-timeline";
import { Eye, EyeOff, Volume2, VolumeX } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  EDITOR_MEDIA_TRACK_ID,
  EDITOR_SUBTITLE_TRACK_ID,
  timelineScrollLeftForCenteredTime,
  type EditorTimelineTrackKind,
} from "@/components/editor/editorTimelineEngine";
import "@techsquidtv/canvas-timeline/styles.css";

interface ActiveSubtitleEdit {
  clipId: string;
  region: ClipHitRegion;
  startClientX: number;
  startLeft: number;
  startRight: number;
  command: TimelineEditCommand | null;
}

interface SubtitleEditOverlay {
  height: number;
  label: string;
  left: number;
  top: number;
  width: number;
}

interface EditorTimelineProperties {
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
}

function TrackHeaderColumn({ muted, onMutedChange }: EditorTimelineProperties) {
  const { tracks } = useTimelineTracks<EditorTimelineTrackKind>();

  return (
    <Timeline.TrackHeaderList className="h-full">
      {tracks.map((track) => (
        <Timeline.TrackHeader key={track.id} trackId={track.id}>
          {(header: UseTimelineTrackHeaderResult<EditorTimelineTrackKind>) => (
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

function timelinePoint(event: ReactPointerEvent<HTMLDivElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y:
      event.clientY -
      bounds.top +
      defaultTimelineInteractionGeometry.rulerHeight,
  };
}

function EditableClipInteractionLayer() {
  const { engine } = useTimeline();
  const activeEdit = useRef<ActiveSubtitleEdit | null>(null);
  const [editOverlay, setEditOverlay] = useState<SubtitleEditOverlay | null>(
    null,
  );

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" && event.button !== 0) {
      return;
    }
    const point = timelinePoint(event);
    const hit = engine.getClipAtPoint({
      ...defaultTimelineInteractionGeometry,
      ...point,
      pointerType: event.pointerType,
    });
    if (!hit) {
      return;
    }
    const found = engine.getClip(hit.clip.id);
    if (found?.track.id !== EDITOR_SUBTITLE_TRACK_ID) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    engine.selectClip(hit.clip.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    activeEdit.current = {
      clipId: hit.clip.id,
      region: hit.region,
      startClientX: event.clientX,
      startLeft: hit.rect.x,
      startRight: hit.rect.x + hit.rect.width,
      command: null,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const edit = activeEdit.current;
    if (!edit) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - edit.startClientX;
    let command: TimelineEditCommand;
    if (edit.region === "start-edge") {
      command = {
        type: "trim",
        clipId: edit.clipId,
        edge: "start",
        // eslint-disable-next-line unicorn/no-keyword-prefix -- Canvas Timeline command field.
        newTime: engine.pixelToTime(edit.startLeft + deltaX),
        snap: false,
      };
    } else if (edit.region === "end-edge") {
      command = {
        type: "trim",
        clipId: edit.clipId,
        edge: "end",
        // eslint-disable-next-line unicorn/no-keyword-prefix -- Canvas Timeline command field.
        newTime: engine.pixelToTime(edit.startRight + deltaX),
        snap: false,
      };
    } else {
      command = {
        type: "move",
        clipId: edit.clipId,
        startTime: engine.pixelToTime(edit.startLeft + deltaX),
        targetTrackId: EDITOR_SUBTITLE_TRACK_ID,
        snap: false,
      };
    }
    const preview = engine.previewEdit(command);
    edit.command = preview.valid ? command : null;
    const previewClip = preview.changedClips.find(
      (clip) => clip.id === edit.clipId,
    );
    const originalRect = engine.getClipRect(
      edit.clipId,
      defaultTimelineInteractionGeometry,
    );
    if (!preview.valid || !previewClip || !originalRect) {
      setEditOverlay(null);
      return;
    }
    const left = engine.timeToPixel(previewClip.timelineStart);
    setEditOverlay({
      height: originalRect.height,
      label: previewClip.label?.replaceAll("\n", " ") ?? "Subtitle cue",
      left,
      top: originalRect.y,
      width: Math.max(1, engine.timeToPixel(previewClip.timelineEnd) - left),
    });
  }

  function finishEdit(
    event: ReactPointerEvent<HTMLDivElement>,
    commit: boolean,
  ) {
    const edit = activeEdit.current;
    if (!edit) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    activeEdit.current = null;
    setEditOverlay(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (commit && edit.command) {
      engine.commitEdit(edit.command);
    } else {
      engine.cancelEdit();
    }
  }

  return (
    <>
      {editOverlay && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-20 overflow-hidden rounded-[var(--radius-control)] border border-editor-accent bg-editor-accent/35 px-2 text-xs leading-none text-foreground shadow-sm"
          style={{
            height: editOverlay.height,
            left: editOverlay.left,
            lineHeight: `${editOverlay.height}px`,
            top:
              editOverlay.top - defaultTimelineInteractionGeometry.rulerHeight,
            width: editOverlay.width,
          }}
        >
          <span className="block truncate">{editOverlay.label}</span>
        </div>
      )}
      <Timeline.ClipInteractionLayer
        selectOnNavigate
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) =>
          finishEdit(event, true)
        }
        onPointerCancel={(event: ReactPointerEvent<HTMLDivElement>) =>
          finishEdit(event, false)
        }
        onLostPointerCapture={(event: ReactPointerEvent<HTMLDivElement>) =>
          finishEdit(event, false)
        }
      />
    </>
  );
}

function EditorTimelineLayers() {
  const { tracks } = useTimelineTracks<EditorTimelineTrackKind>();

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
      <EditableClipInteractionLayer />
      <Timeline.RangeSelector />
    </>
  );
}

function CenterViewportOnInPoint() {
  const { engine, state } = useTimeline();
  const zoomScale = useRef(state.zoomScale);
  zoomScale.current = state.zoomScale;
  const inPointSeconds = state.inPoint ? toSeconds(state.inPoint) : undefined;
  const durationSeconds = state.duration
    ? toSeconds(state.duration)
    : undefined;
  const viewportWidth = state.viewportWidth ?? 0;

  useEffect(() => {
    if (inPointSeconds === undefined || viewportWidth <= 0) {
      return;
    }

    engine.setScrollLeft(
      timelineScrollLeftForCenteredTime({
        maxScrollLeft: engine.maxScrollLeft,
        timeSeconds: inPointSeconds,
        viewportWidth,
        zoomScale: zoomScale.current,
      }),
    );
  }, [durationSeconds, engine, inPointSeconds, viewportWidth]);

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
