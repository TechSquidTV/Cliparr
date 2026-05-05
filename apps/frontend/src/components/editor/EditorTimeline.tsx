import { useCallback } from "react";
import { Timeline, type TimelineState } from "@xzdarcy/react-timeline-editor";
import "@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css";
import type { RefObject, WheelEvent as ReactWheelEvent } from "react";
import { Scissors } from "lucide-react";
import { 
  formatTime,
  TIMELINE_START_LEFT, 
  type ClipTimelineData, 
  type ClipTimelineEffects, 
  type ClipTimelineAction,
  type TimelineZoomLevel
} from "./EditorUtils";

interface EditorTimelineProps {
  timelineRef: RefObject<TimelineState | null>;
  timelineWheelRegionRef: RefObject<HTMLDivElement | null>;
  timelineData: ClipTimelineData;
  timelineEffects: ClipTimelineEffects;
  activeTimelineScale: TimelineZoomLevel;
  timelineScaleCount: number;
  loadingPreview: boolean;
  playing: boolean;
  handleTimelineScroll: (data: { scrollLeft: number }) => void;
  handleTimelineChange: (data: ClipTimelineData) => void;
  handleTimelineActionMoveEnd: (params: { action: { id: string }; start: number; end: number }) => void;
  handleTimelineActionResizeEnd: (params: { action: { id: string }; start: number; end: number }) => void;
  handleTimelineWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  isValidTimelineRange: (start: number, end: number) => boolean;
  seekToTime: (time: number) => Promise<void> | void;
  onCursorDragStart: () => void;
  onCursorDrag: (time: number) => void;
}

export function EditorTimeline({
  timelineRef,
  timelineWheelRegionRef,
  timelineData,
  timelineEffects,
  activeTimelineScale,
  timelineScaleCount,
  loadingPreview,
  playing,
  handleTimelineScroll,
  handleTimelineChange,
  handleTimelineActionMoveEnd,
  handleTimelineActionResizeEnd,
  handleTimelineWheel,
  isValidTimelineRange,
  seekToTime,
  onCursorDragStart,
  onCursorDrag,
}: EditorTimelineProps) {
  const renderClipTimelineAction = useCallback((action: ClipTimelineAction) => {
    const isSource = action.effectId === "source";

    return (
      <div className="cliparr-timeline-action-content">
        <span className="cliparr-timeline-action-label">
          {!isSource && <Scissors className="h-3.5 w-3.5" />}
          {isSource ? "Source" : "Selection"}
        </span>
      </div>
    );
  }, []);

  return (
    <div
      ref={timelineWheelRegionRef}
      className="cliparr-timeline"
      onWheelCapture={handleTimelineWheel}
    >
      <Timeline
        ref={timelineRef}
        editorData={timelineData}
        effects={timelineEffects}
        scale={activeTimelineScale.scale}
        scaleSplitCount={activeTimelineScale.scaleSplitCount}
        scaleWidth={activeTimelineScale.scaleWidth}
        minScaleCount={timelineScaleCount}
        maxScaleCount={timelineScaleCount}
        startLeft={TIMELINE_START_LEFT}
        rowHeight={44}
        autoScroll
        hideCursor={false}
        dragLine
        disableDrag={loadingPreview || playing}
        onScroll={handleTimelineScroll}
        onChange={handleTimelineChange}
        onActionMoving={({ start, end }) => isValidTimelineRange(start, end)}
        onActionResizing={({ start, end }) => isValidTimelineRange(start, end)}
        onActionMoveEnd={handleTimelineActionMoveEnd}
        onActionResizeEnd={handleTimelineActionResizeEnd}
        onClickTimeArea={(time) => {
          void seekToTime(time);
          return false;
        }}
        onCursorDragStart={onCursorDragStart}
        onCursorDrag={onCursorDrag}
        onCursorDragEnd={(time) => {
          void seekToTime(time);
        }}
        getScaleRender={formatTime}
        getActionRender={renderClipTimelineAction}
      />
    </div>
  );
}
