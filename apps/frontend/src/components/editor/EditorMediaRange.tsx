import {
  RangeScrollbar,
  Timeline,
  fromSeconds,
  useTimelineInOutRangeControl,
  useTimelinePlayback,
  useTimelineScrollLeft,
  useTimelineTrack,
  useTimelineZoomScale,
  type TimelineEngine,
} from "@techsquidtv/canvas-timeline";
import {
  EDITOR_MEDIA_RANGE_HANDLE_WIDTH,
  EDITOR_MEDIA_RANGE_INSET,
} from "@/components/editor/EditorMediaRangeCanvas";
import { EDITOR_MEDIA_TRACK_ID } from "@/components/editor/editorTimelineEngine";
import {
  formatTime,
  MIN_CLIP_SECONDS,
} from "@/components/editor/editorUtilities";

// The source clip stays full-length for preview and source timestamp mapping.
// Its visible row represents the export range, using the same In/Out state as
// time fields, shortcuts, drafts, and history rather than editing source media.
export function EditorMediaRange({ engine }: { engine: TimelineEngine }) {
  const { setPlayheadTime } = useTimelinePlayback();
  const { rect } = useTimelineTrack(EDITOR_MEDIA_TRACK_ID);
  const scrollLeft = useTimelineScrollLeft();
  const zoomScale = useTimelineZoomScale();
  const range = useTimelineInOutRangeControl();
  const [start, end] = range.value;

  if (!rect) {
    return null;
  }

  return (
    <div
      className="editor-media-range-row"
      style={{ top: rect.y, height: rect.height }}
    >
      <Timeline.PlayheadArea
        className="editor-media-range-scrub"
        title="Scrub source media"
        onDoubleClick={setPlayheadTime}
      />
      <RangeScrollbar.Root
        className="editor-media-range"
        min={range.min}
        max={range.max}
        minSpan={MIN_CLIP_SECONDS}
        value={{ start, end }}
        keyboardStep={range.step}
        keyboardPageStep={1}
        getAriaValueText={(value, details) =>
          details.part === "thumb"
            ? `${formatTime(start)} to ${formatTime(end)}, duration ${formatTime(end - start)}`
            : formatTime(value)
        }
        onValueChange={({ start, end }, details) => {
          // Native drags retain the callback from pointerdown. Apply the whole
          // range atomically so returning to the gesture's start still updates.
          engine.setInOutRange(fromSeconds(start), fromSeconds(end));
          if (
            details.reason === "thumb-keyboard" ||
            details.reason === "handle-keyboard"
          ) {
            engine.settle();
          }
        }}
        onPointerUp={() => engine.settle()}
        onPointerCancel={() => engine.settle()}
        style={{
          top: EDITOR_MEDIA_RANGE_INSET,
          height: rect.height - EDITOR_MEDIA_RANGE_INSET * 2,
          width: range.max * zoomScale,
          transform: `translateX(${-scrollLeft}px)`,
        }}
      >
        <RangeScrollbar.Thumb
          role="slider"
          aria-label="Move clip selection"
          title="Drag to move selection; drag either edge to trim"
        >
          <RangeScrollbar.Handle
            side="start"
            style={{ width: `min(${EDITOR_MEDIA_RANGE_HANDLE_WIDTH}px, 25%)` }}
            role="slider"
            aria-label="Clip start"
            title="Trim clip start"
          />
          <RangeScrollbar.Handle
            side="end"
            style={{ width: `min(${EDITOR_MEDIA_RANGE_HANDLE_WIDTH}px, 25%)` }}
            role="slider"
            aria-label="Clip end"
            title="Trim clip end"
          />
        </RangeScrollbar.Thumb>
      </RangeScrollbar.Root>
    </div>
  );
}
