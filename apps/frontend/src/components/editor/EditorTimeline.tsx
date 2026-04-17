import { useCallback, RefObject } from "react";
import { Timeline } from "@xzdarcy/react-timeline-editor";
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
  timelineRef: RefObject<any>;
  timelineWheelRegionRef: RefObject<HTMLDivElement | null>;
  timelineData: ClipTimelineData;
  timelineEffects: ClipTimelineEffects;
  activeTimelineScale: TimelineZoomLevel;
  timelineScaleCount: number;
  loadingPreview: boolean;
  playing: boolean;
  duration: number;
  handleTimelineScroll: (data: { scrollLeft: number }) => void;
  handleTimelineChange: (data: ClipTimelineData) => void;
  handleTimelineWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  isValidTimelineRange: (start: number, end: number) => boolean;
  seekToTime: (time: number) => void;
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
  duration,
  handleTimelineScroll,
  handleTimelineChange,
  handleTimelineWheel,
  isValidTimelineRange,
  seekToTime,
  onCursorDragStart,
  onCursorDrag,
}: EditorTimelineProps) {
  const renderClipTimelineAction = useCallback((action: ClipTimelineAction) => (
    <div className="cliparr-timeline-action-content">
      <span className="cliparr-timeline-action-label">
        {action.effectId === "clip" && <Scissors className="h-3.5 w-3.5" />}
        {action.effectId === "source" ? "Full video" : "Clip"}
      </span>
      <span className="cliparr-timeline-action-time">
        {action.effectId === "source"
          ? formatTime(action.end)
          : `${formatTime(action.start)} - ${formatTime(action.end)}`}
      </span>
    </div>
  ), []);

  return (
    <div
      ref={timelineWheelRegionRef}
      className="cliparr-timeline"
      onWheelCapture={handleTimelineWheel}
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Full video</span>
        <span className="font-mono">0:00 - {formatTime(duration)}</span>
      </div>
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
        dragLine
        disableDrag={loadingPreview || playing}
        onScroll={handleTimelineScroll}
        onChange={handleTimelineChange}
        onActionMoving={({ start, end }) => isValidTimelineRange(start, end)}
        onActionResizing={({ start, end }) => isValidTimelineRange(start, end)}
        onActionMoveEnd={({ start }) => {
          void seekToTime(start);
        }}
        onActionResizeEnd={({ start, end, dir }) => {
          void seekToTime(dir === "left" ? start : end);
        }}
        onClickTimeArea={(time) => {
          void seekToTime(time);
          return false;
        }}
        onClickRow={(_, { time }) => {
          void seekToTime(time);
        }}
        onClickActionOnly={(_, { time }) => {
          void seekToTime(time);
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
