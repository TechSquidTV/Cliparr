import { useCallback } from "react";
import { Timeline, type TimelineState } from "@xzdarcy/react-timeline-editor";
import "@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css";
import type { CSSProperties, RefObject } from "react";
import { Scissors } from "lucide-react";
import type { PlaybackReadyRange } from "./useEditorPlayback";
import { isPlaybackReadyRangeVisible } from "./editorPlaybackWarmupRange";
import {
  formatTime,
  getTimelineFillPercentages,
  TIMELINE_START_LEFT,
  type ClipTimelineData,
  type ClipTimelineEffects,
  type ClipTimelineAction,
  type TimelineZoomLevel,
} from "./editorUtils";

interface EditorTimelineProps {
  timelineRef: RefObject<TimelineState | null>;
  timelineWheelRegionRef: RefObject<HTMLDivElement | null>;
  timelineData: ClipTimelineData;
  timelineEffects: ClipTimelineEffects;
  activeTimelineScale: TimelineZoomLevel;
  timelineScaleCount: number;
  playbackReadyRange: PlaybackReadyRange | null;
  loadingPreview: boolean;
  playing: boolean;
  handleTimelineScroll: (data: { scrollLeft: number }) => void;
  handleTimelineChange: (data: ClipTimelineData) => void;
  handleTimelineActionMoveEnd: (params: {
    action: { id: string };
    start: number;
    end: number;
  }) => void;
  handleTimelineActionResizeEnd: (params: {
    action: { id: string };
    start: number;
    end: number;
  }) => void;
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
  playbackReadyRange,
  loadingPreview,
  playing,
  handleTimelineScroll,
  handleTimelineChange,
  handleTimelineActionMoveEnd,
  handleTimelineActionResizeEnd,
  isValidTimelineRange,
  seekToTime,
  onCursorDragStart,
  onCursorDrag,
}: EditorTimelineProps) {
  const getReadyFillStyle = useCallback(
    (action: ClipTimelineAction): CSSProperties | null => {
      if (
        action.effectId !== "clip" ||
        !playbackReadyRange ||
        !isPlaybackReadyRangeVisible(playbackReadyRange)
      ) {
        return null;
      }

      const fill = getTimelineFillPercentages({
        trackStart: action.start,
        trackEnd: action.end,
        fillStart: playbackReadyRange.startTime,
        fillEnd: Math.min(
          playbackReadyRange.readyUntilTime,
          playbackReadyRange.endTime,
        ),
      });
      if (
        !fill ||
        (fill.widthPercent <= 0 && playbackReadyRange.status !== "warming")
      ) {
        return null;
      }

      return {
        left: `${fill.leftPercent}%`,
        width: `${fill.widthPercent}%`,
      };
    },
    [playbackReadyRange],
  );

  const renderClipTimelineAction = useCallback(
    (action: ClipTimelineAction) => {
      const isSource = action.effectId === "source";
      const readyFillStyle = getReadyFillStyle(action);

      return (
        <div className="cliparr-timeline-action-content">
          {readyFillStyle && playbackReadyRange && (
            <span
              className="cliparr-timeline-action-ready-fill"
              data-status={playbackReadyRange.status}
              style={readyFillStyle}
              aria-hidden="true"
            />
          )}
          <span className="cliparr-timeline-action-label">
            {!isSource && <Scissors className="h-3.5 w-3.5" />}
            {isSource ? "Source" : "Selection"}
          </span>
        </div>
      );
    },
    [getReadyFillStyle, playbackReadyRange],
  );

  return (
    <div ref={timelineWheelRegionRef} className="cliparr-timeline">
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
        onClickRow={(event, { time }) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.closest(".timeline-editor-action")
          ) {
            return;
          }

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
