import "@techsquidtv/canvas-timeline/styles.css";

import {
  CanvasRenderer,
  Timeline,
  type TimelineEngine,
  type UseTimelineTrackHeaderResult,
  useTimelineTracks,
} from "@techsquidtv/canvas-timeline";
import { Captions, Plus, Volume2, VolumeX } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
} from "react";

import type { EditorLayoutVariant } from "@/components/editor/EditorLayout";
import { EditorMediaRange } from "@/components/editor/EditorMediaRange";
import { EditorMediaRangeCanvas } from "@/components/editor/EditorMediaRangeCanvas";
import {
  EDITOR_MEDIA_TRACK_ID,
  EDITOR_SUBTITLE_TRACK_ID,
} from "@/components/editor/editorTimelineEngine";
import { zoomEditorTimeline } from "@/components/editor/editorTimelineZoom";
import { EditorViewportScrollbar } from "@/components/editor/EditorViewportScrollbar";
import { editorIconButtonClassName } from "@/components/ui/control-styles";
import { ControlTooltip } from "@/components/ui/tooltip";

interface EditorTimelineProperties {
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  canAddSubtitle: boolean;
  onAddSubtitle: () => void;
  onOpenSubtitles: () => void;
  trackNamesVisible: boolean;
}

function TrackHeaderColumn({
  muted,
  onMutedChange,
  canAddSubtitle,
  onAddSubtitle,
  onOpenSubtitles,
  trackNamesVisible,
}: EditorTimelineProperties) {
  const { tracks } = useTimelineTracks();

  return (
    <Timeline.TrackHeaderList className="h-full">
      {tracks.map((track) => (
        <Timeline.TrackHeader
          key={track.id}
          trackId={track.id}
          className="!px-0 lg:!px-2"
        >
          {(header: UseTimelineTrackHeaderResult) => (
            <div className="flex h-full min-w-0 flex-1 items-center gap-2">
              {track.id === EDITOR_MEDIA_TRACK_ID ? (
                <ControlTooltip
                  label={muted ? "Unmute preview" : "Mute preview"}
                >
                  <button
                    type="button"
                    onClick={() => onMutedChange(!muted)}
                    aria-label={muted ? "Unmute preview" : "Mute preview"}
                    aria-pressed={muted}
                    className={editorIconButtonClassName({
                      size: "sm",
                      variant: "ghost",
                      className: "h-11 w-11 shrink-0 lg:h-7 lg:w-7",
                    })}
                  >
                    {muted ? (
                      <VolumeX aria-hidden="true" className="h-3.5 w-3.5" />
                    ) : (
                      <Volume2 aria-hidden="true" className="h-3.5 w-3.5" />
                    )}
                  </button>
                </ControlTooltip>
              ) : (
                <ControlTooltip label="Subtitle tools">
                  <button
                    type="button"
                    onClick={onOpenSubtitles}
                    aria-label="Subtitle tools"
                    className={editorIconButtonClassName({
                      variant: "ghost",
                      className: "h-11 w-11 shrink-0 lg:h-7 lg:w-7",
                    })}
                  >
                    <Captions className="h-4 w-4" />
                  </button>
                </ControlTooltip>
              )}
              <span
                className={`${trackNamesVisible ? "" : "hidden lg:block"} min-w-0 flex-1 truncate text-xs font-medium text-foreground`}
              >
                {header.label}
              </span>
              {track.id !== EDITOR_MEDIA_TRACK_ID && (
                <ControlTooltip label="Add subtitle at playhead">
                  <button
                    type="button"
                    aria-label="Add subtitle at playhead"
                    disabled={!canAddSubtitle}
                    onClick={onAddSubtitle}
                    className={editorIconButtonClassName({
                      variant: "ghost",
                      className: `${trackNamesVisible ? "" : "hidden lg:inline-flex"} h-11 w-11 lg:h-8 lg:w-8 shrink-0 rounded text-foreground disabled:opacity-40`,
                    })}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </ControlTooltip>
              )}
              <Timeline.TrackHeaderResizeHandle
                trackId={track.id}
                maxHeight={96}
                className="hidden lg:block"
              />
            </div>
          )}
        </Timeline.TrackHeader>
      ))}
    </Timeline.TrackHeaderList>
  );
}

function EditorTimelineLayers({ engine }: { engine: TimelineEngine }) {
  const { tracks } = useTimelineTracks();

  return (
    <>
      <Timeline.PlayheadArea />
      <Timeline.PlayheadGrabber />
      <Timeline.TrackList className="timeline-track-list-overlay">
        {tracks.map((track) => (
          <Timeline.Track key={track.id} trackId={track.id} />
        ))}
      </Timeline.TrackList>
      <Timeline.ClipInteractionLayer selectOnNavigate />
      <EditorMediaRange engine={engine} />
    </>
  );
}

export function EditorTimeline({
  engine,
  muted,
  onMutedChange,
  canAddSubtitle,
  onAddSubtitle,
  onOpenSubtitles,
  trackNamesVisible,
  subtitleLoading,
  onInteractionStart,
  variant,
}: EditorTimelineProperties & {
  engine: TimelineEngine;
  variant: EditorLayoutVariant;
  subtitleLoading: boolean;
  onInteractionStart: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const tap = useRef<{
    pointerId: number;
    x: number;
    y: number;
    clipId: string;
  } | null>(null);
  const activationFrame = useRef(0);
  useEffect(() => {
    const cancelTap = () => {
      tap.current = null;
      cancelAnimationFrame(activationFrame.current);
    };
    window.addEventListener("blur", cancelTap);
    return () => {
      window.removeEventListener("blur", cancelTap);
      cancelTap();
    };
  }, [variant]);
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
    <div
      inert={subtitleLoading}
      onPointerDownCapture={onInteractionStart}
      onKeyDownCapture={onInteractionStart}
      className={`flex h-full min-h-0 flex-col ${trackNamesVisible ? "[--editor-track-header-width:10rem]" : "[--editor-track-header-width:2.75rem]"} lg:[--editor-track-header-width:9rem]`}
    >
      <div className="min-h-0 flex-1">
        <div className="cliparr-timeline-v2 flex h-full min-h-0 w-full flex-col bg-editor-panel lg:w-full">
          <div className="flex min-h-0 flex-1">
            <div className="w-[var(--editor-track-header-width)] shrink-0 border-r border-editor-border bg-editor-panel-muted/55">
              <TrackHeaderColumn
                muted={muted}
                onMutedChange={onMutedChange}
                canAddSubtitle={canAddSubtitle}
                onAddSubtitle={onAddSubtitle}
                onOpenSubtitles={onOpenSubtitles}
                trackNamesVisible={trackNamesVisible}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Timeline.Root
                ref={root}
                data-editor-timeline-viewport
                className="h-full w-full"
                onPointerDownCapture={(event: PointerEvent<HTMLDivElement>) => {
                  tap.current = null;
                  cancelAnimationFrame(activationFrame.current);
                  if (
                    variant !== "mobile" ||
                    !event.isPrimary ||
                    event.button !== 0
                  ) {
                    return;
                  }
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const hit = engine.geometry.getClipAtPoint({
                    x: event.clientX - bounds.left,
                    y: event.clientY - bounds.top,
                    pointerType: event.pointerType,
                  });
                  if (
                    hit?.track.id === EDITOR_SUBTITLE_TRACK_ID &&
                    hit.region === "body"
                  ) {
                    tap.current = {
                      pointerId: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      clipId: hit.clip.id,
                    };
                  }
                }}
                onPointerMoveCapture={(event: PointerEvent<HTMLDivElement>) => {
                  if (
                    tap.current &&
                    Math.hypot(
                      event.clientX - tap.current.x,
                      event.clientY - tap.current.y,
                    ) > 6
                  ) {
                    tap.current = null;
                  }
                }}
                onPointerCancelCapture={() => {
                  tap.current = null;
                }}
                onPointerUpCapture={(event: PointerEvent<HTMLDivElement>) => {
                  const activation = tap.current;
                  tap.current = null;
                  if (!activation || activation.pointerId !== event.pointerId) {
                    return;
                  }
                  activationFrame.current = requestAnimationFrame(() => {
                    if (
                      engine.geometry.getClip(activation.clipId)?.clip.selected
                    ) {
                      onOpenSubtitles();
                    }
                  });
                }}
                onKeyUp={(event: KeyboardEvent<HTMLDivElement>) => {
                  if (
                    variant !== "mobile" ||
                    event.key !== "Enter" ||
                    (event.target instanceof Element &&
                      event.target.closest("button,input,textarea"))
                  ) {
                    return;
                  }
                  const selected = engine
                    .getState()
                    .tracks.find(
                      (track) => track.id === EDITOR_SUBTITLE_TRACK_ID,
                    )
                    ?.clips.some((clip) => clip.selected);
                  if (selected) {
                    onOpenSubtitles();
                  }
                }}
              >
                <CanvasRenderer showInOutPoints={false} />
                <EditorMediaRangeCanvas />
                <EditorTimelineLayers engine={engine} />
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
    </div>
  );
}
