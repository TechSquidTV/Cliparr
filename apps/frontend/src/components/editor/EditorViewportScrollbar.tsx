import {
  RangeScrollbar,
  Timeline,
  useTimelineViewportRangeControl,
  type RangeScrollbarHandleSide,
  type RangeScrollbarValue,
} from "@techsquidtv/canvas-timeline";
import { useRef, type PointerEvent, type KeyboardEvent } from "react";
import {
  viewportRangeAfterZoomDrag,
  viewportScrollbarGeometry,
} from "@/components/editor/editorTimelineZoom";

type ViewportControl = ReturnType<typeof useTimelineViewportRangeControl>;

function ZoomHandle({
  side,
  control,
}: {
  side: RangeScrollbarHandleSide;
  control: ViewportControl;
}) {
  const drag = useRef<{
    pointerId: number;
    clientX: number;
    range: RangeScrollbarValue;
  } | null>(null);

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <Timeline.ViewportScrollbarHandle
      side={side}
      title="Drag inward to zoom in; outward to zoom out"
      aria-valuemin={
        side === "start" ? 0 : control.viewStartSeconds + control.range.minSpan
      }
      aria-valuemax={
        side === "start"
          ? control.viewEndSeconds - control.range.minSpan
          : control.totalDurationSeconds
      }
      aria-valuenow={
        side === "start" ? control.viewStartSeconds : control.viewEndSeconds
      }
      aria-valuetext={
        side === "start" ? control.startValueText : control.endValueText
      }
      style={{ touchAction: "none" }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const delta = {
          ArrowLeft: -10,
          ArrowRight: 10,
          PageUp: -120,
          PageDown: 120,
        }[event.key];
        if (delta === undefined) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        control.onValueChange(
          viewportRangeAfterZoomDrag({
            range: {
              start: control.viewStartSeconds,
              end: control.viewEndSeconds,
            },
            side,
            deltaPixels: delta,
            minSpan: control.range.minSpan,
            duration: control.totalDurationSeconds,
          }),
          { reason: "handle-keyboard", side },
        );
      }}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        // Preserve the library's accessible handle while replacing its
        // full-duration linear pointer sensitivity with proportional zoom.
        event.preventDefault();
        event.stopPropagation();
        if (
          (event.pointerType !== "touch" && event.button !== 0) ||
          drag.current
        ) {
          return;
        }
        event.currentTarget.focus();
        drag.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          range: {
            start: control.viewStartSeconds,
            end: control.viewEndSeconds,
          },
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) {
          return;
        }
        control.onValueChange(
          viewportRangeAfterZoomDrag({
            range: active.range,
            side,
            deltaPixels: event.clientX - active.clientX,
            minSpan: control.range.minSpan,
            duration: control.totalDurationSeconds,
          }),
          { reason: "handle-drag", side },
        );
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
    />
  );
}

export function EditorViewportScrollbar() {
  const control = useTimelineViewportRangeControl();
  const geometry = viewportScrollbarGeometry({
    start: control.viewStartSeconds,
    span: control.viewDurationSeconds,
    duration: control.totalDurationSeconds,
    minSpan: control.range.minSpan,
    viewportWidth: control.viewportWidth,
  });
  const panScale =
    geometry.scrollableDuration > 0
      ? geometry.scrollableFraction / geometry.scrollableDuration
      : 0;
  return (
    <RangeScrollbar.Root
      className="timeline-viewport-scrollbar"
      min={0}
      max={1}
      value={geometry.value}
      keyboardStep={(40 / control.zoomScale) * panScale}
      keyboardPageStep={control.viewDurationSeconds * 0.8 * panScale}
      onValueChange={({ start }, details) => {
        const progress =
          geometry.scrollableFraction > 0
            ? Math.min(1, Math.max(0, start / geometry.scrollableFraction))
            : 0;
        const viewStart = progress * geometry.scrollableDuration;
        control.onValueChange(
          { start: viewStart, end: viewStart + control.viewDurationSeconds },
          details,
        );
      }}
    >
      <Timeline.ViewportScrollbarThumb
        style={{ minWidth: 0 }}
        aria-valuemin={0}
        aria-valuemax={geometry.scrollableDuration}
        aria-valuenow={control.viewStartSeconds}
        aria-valuetext={control.valueText}
      >
        <ZoomHandle side="start" control={control} />
        <ZoomHandle side="end" control={control} />
      </Timeline.ViewportScrollbarThumb>
    </RangeScrollbar.Root>
  );
}
