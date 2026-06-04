import { useCallback, useMemo } from "react";
import { Timeline, type TimelineState } from "@xzdarcy/react-timeline-editor";
import "@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css";
import type { CSSProperties, RefObject } from "react";
import { Captions, LoaderCircle, Scissors } from "lucide-react";
import type { PlaybackReadyRange } from "@/components/editor/useEditorPlayback";
import { isPlaybackReadyRangeVisible } from "@/components/editor/editorPlaybackWarmupRange";
import {
  formatTime,
  getTimelineFillPercentages,
  TIMELINE_START_LEFT,
  type ClipTimelineData,
  type ClipTimelineEffects,
  type ClipTimelineAction,
  type TimelineZoomLevel,
} from "@/components/editor/editorUtils";
import {
  SUBTITLE_LOADING_ACTION_ID,
  subtitleCueActionId,
  subtitleCueIdFromActionId,
  type EditableSubtitleCue,
} from "@/components/editor/editorSubtitleCues";

interface EditorTimelineProps {
  timelineRef: RefObject<TimelineState | null>;
  timelineWheelRegionRef: RefObject<HTMLDivElement | null>;
  timelineData: ClipTimelineData;
  timelineEffects: ClipTimelineEffects;
  activeTimelineScale: TimelineZoomLevel;
  timelineScaleCount: number;
  playbackReadyRange: PlaybackReadyRange | null;
  subtitleCues: readonly EditableSubtitleCue[];
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
  onSubtitleCueSelect: (cueId: string | null) => void;
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
  subtitleCues,
  loadingPreview,
  playing,
  handleTimelineScroll,
  handleTimelineChange,
  handleTimelineActionMoveEnd,
  handleTimelineActionResizeEnd,
  isValidTimelineRange,
  seekToTime,
  onSubtitleCueSelect,
  onCursorDragStart,
  onCursorDrag,
}: EditorTimelineProps) {
  const subtitlePreviewTextByActionId = useMemo(() => {
    return new Map(
      subtitleCues.map((cue) => {
        const previewText = cue.lines.join(" ").trim() || "Empty subtitle";
        return [subtitleCueActionId(cue.id), previewText] as const;
      }),
    );
  }, [subtitleCues]);

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
      if (action.effectId === "subtitle-placeholder") {
        return (
          <div className="cliparr-timeline-action-content cliparr-timeline-subtitle-placeholder">
            <span className="cliparr-timeline-action-label">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Loading subtitles
            </span>
          </div>
        );
      }

      if (action.effectId === "subtitle") {
        return (
          <div className="cliparr-timeline-action-content cliparr-timeline-subtitle-content">
            <span className="cliparr-timeline-action-label cliparr-timeline-subtitle-label">
              <Captions className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {subtitlePreviewTextByActionId.get(action.id) ?? "Subtitle cue"}
              </span>
            </span>
          </div>
        );
      }

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
    [getReadyFillStyle, playbackReadyRange, subtitlePreviewTextByActionId],
  );

  const selectSubtitleTimelineAction = useCallback(
    (action: { id: string; effectId?: string }) => {
      if (action.effectId !== "subtitle") {
        onSubtitleCueSelect(null);
        return;
      }

      onSubtitleCueSelect(subtitleCueIdFromActionId(action.id));
    },
    [onSubtitleCueSelect],
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
        onActionMoveStart={({ action }) => {
          selectSubtitleTimelineAction(action);
        }}
        onActionResizeStart={({ action }) => {
          selectSubtitleTimelineAction(action);
        }}
        onActionMoveEnd={handleTimelineActionMoveEnd}
        onActionResizeEnd={handleTimelineActionResizeEnd}
        onClickTimeArea={(time) => {
          onSubtitleCueSelect(null);
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

          onSubtitleCueSelect(null);
          void seekToTime(time);
        }}
        onClickActionOnly={(_, { action, time }) => {
          if (action.id !== SUBTITLE_LOADING_ACTION_ID) {
            selectSubtitleTimelineAction(action);
          }
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
