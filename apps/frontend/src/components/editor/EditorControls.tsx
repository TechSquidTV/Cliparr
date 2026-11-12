import { formatTimecode } from "@techsquidtv/canvas-timeline/utils";
import {
  Camera,
  Crop,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { type CSSProperties, memo, type ReactNode, useMemo } from "react";

import { EditorEditableTimecode } from "@/components/editor/EditorEditableTimecode";
import type { EditorLayoutVariant } from "@/components/editor/EditorLayout";
import { EditorPreviewTimecode } from "@/components/editor/EditorPreviewTimecode";
import { formatTime } from "@/components/editor/editorUtilities";
import { editorIconButtonClassName } from "@/components/ui/control-styles";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { ControlTooltip } from "@/components/ui/tooltip";

export type EditorControlsSection = "workspace" | "trim" | "playback";

interface EditorControlsProperties {
  variant?: EditorLayoutVariant;
  section?: EditorControlsSection;
  historyControls?: ReactNode;
  onTrimClick?: () => void;
  inspectorOpen?: boolean;
  trackNamesVisible?: boolean;
  onTrackNamesVisibleChange?: (visible: boolean) => void;
  playing: boolean;
  loadingPreview: boolean;
  togglePlay: () => void;
  currentTime: number;
  duration: number;
  startTime: number;
  endTime: number;
  muted: boolean;
  setMuted: (muted: boolean | ((previous: boolean) => boolean)) => void;
  volume: number;
  setVolume: (volume: number) => void;
  handleTimelineZoomIn: () => void;
  handleTimelineZoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onFramegrabClick: () => void;
  framegrabDisabledReason: string | null;
  onCropClick?: () => void;
  cropActive?: boolean;
  cropDisabled?: boolean;
  onPreviewTimeCommit: (time: number) => void | Promise<void>;
  onStartTimeCommit: (time: number) => void | Promise<void>;
  onEndTimeCommit: (time: number) => void | Promise<void>;
  onSetInPoint: () => void;
  onSetOutPoint: () => void;
  onClearPoints: () => void;
  onFitSelection: () => void;
}

export const EditorControls = memo(function EditorControls({
  variant = "desktop",
  section = "workspace",
  historyControls,
  onTrimClick,
  inspectorOpen = false,
  trackNamesVisible = false,
  onTrackNamesVisibleChange,
  playing,
  loadingPreview,
  togglePlay,
  currentTime,
  duration,
  startTime,
  endTime,
  muted,
  setMuted,
  volume,
  setVolume,
  handleTimelineZoomIn,
  handleTimelineZoomOut,
  canZoomIn,
  canZoomOut,
  onFramegrabClick,
  framegrabDisabledReason,
  onCropClick,
  cropActive,
  cropDisabled,
  onPreviewTimeCommit,
  onStartTimeCommit,
  onEndTimeCommit,
  onSetInPoint,
  onSetOutPoint,
  onClearPoints,
  onFitSelection,
}: EditorControlsProperties) {
  const hasDuration = duration > 0;
  const canEditPreviewTime = !loadingPreview && hasDuration;
  const canSetClipRange = !loadingPreview && hasDuration;
  const canEditClipTimecode = canSetClipRange && !playing;
  const clipMetrics = useMemo(() => {
    const clipDuration = Math.max(0, endTime - startTime);

    return [
      { label: "In", value: startTime, onCommit: onStartTimeCommit },
      { label: "Out", value: endTime, onCommit: onEndTimeCommit },
      { label: "Duration", value: clipDuration, emphasized: true },
    ];
  }, [endTime, onEndTimeCommit, onStartTimeCommit, startTime]);
  const clipMetricTimeStyle = useMemo<CSSProperties>(
    () => ({
      width: `calc(${formatTimecode(duration).length}ch + 1.5rem + 2px)`,
    }),
    [duration],
  );
  const volumeRangeFillPercent = `${
    Math.min(Math.max(muted ? 0 : volume, 0), 1) * 100
  }%`;
  let playControlLabel = "Play preview";
  if (loadingPreview) {
    playControlLabel = "Preview is loading.";
  } else if (playing) {
    playControlLabel = "Pause preview";
  }

  const playControl = (
    <ControlTooltip label={playControlLabel} disabled={loadingPreview}>
      <button
        type="button"
        onClick={togglePlay}
        disabled={loadingPreview}
        aria-label={playing ? "Pause preview" : "Play preview"}
        className={editorIconButtonClassName({
          variant: variant === "mobile" ? "ghost" : "outline",
          className: variant === "mobile" ? "h-11 w-11" : undefined,
        })}
      >
        {playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="ml-0.5 h-4 w-4" />
        )}
      </button>
    </ControlTooltip>
  );
  const previewTimeControl = (
    <EditorEditableTimecode
      ariaLabel="preview time"
      buttonClassName="editor-control-focus rounded-[var(--radius-control)] px-1 text-foreground hover:bg-editor-control-hover"
      disabled={!canEditPreviewTime}
      onCommit={onPreviewTimeCommit}
      value={currentTime}
      valueLabel={`${formatTimecode(currentTime)} of ${formatTimecode(duration)}`}
    >
      <EditorPreviewTimecode
        ariaHidden
        className={
          variant === "mobile"
            ? "text-[clamp(0.6875rem,6cqi,0.875rem)]"
            : undefined
        }
        currentTime={currentTime}
        duration={duration}
      />
    </EditorEditableTimecode>
  );
  const volumeControl = (
    <div className="flex items-center gap-2">
      <ControlTooltip
        label={muted || volume === 0 ? "Unmute preview" : "Mute preview"}
      >
        <button
          type="button"
          onClick={() => setMuted((current) => !current)}
          className={editorIconButtonClassName({
            variant: variant === "mobile" ? "ghost" : "outline",
            className: variant === "mobile" ? "h-11 w-11" : undefined,
          })}
          aria-label={muted || volume === 0 ? "Unmute preview" : "Mute preview"}
        >
          {muted || volume === 0 ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </button>
      </ControlTooltip>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(event) => {
          const nextVolume = Number(event.target.value);
          setVolume(nextVolume);
          setMuted(nextVolume === 0);
        }}
        className="cliparr-editor-range min-h-11 w-24 sm:w-28 lg:min-h-6"
        aria-label="Preview volume"
        style={
          {
            "--cliparr-range-fill": volumeRangeFillPercent,
          } as CSSProperties
        }
      />
    </div>
  );
  const zoomControl = (
    <div className="flex items-center overflow-hidden rounded-[var(--radius-control)] border border-editor-border bg-editor-control">
      <ControlTooltip
        label={canZoomOut ? "Zoom timeline out" : "Already fully zoomed out"}
        disabled={!canZoomOut}
      >
        <button
          type="button"
          onClick={handleTimelineZoomOut}
          disabled={!canZoomOut}
          className={editorIconButtonClassName({
            variant: "ghost",
            className: "rounded-none disabled:opacity-45",
          })}
          aria-label="Zoom timeline out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
      </ControlTooltip>
      <ControlTooltip
        label={canZoomIn ? "Zoom timeline in" : "Already fully zoomed in"}
        disabled={!canZoomIn}
      >
        <button
          type="button"
          onClick={handleTimelineZoomIn}
          disabled={!canZoomIn}
          className={editorIconButtonClassName({
            variant: "ghost",
            className:
              "rounded-none border-l border-editor-border disabled:opacity-45",
          })}
          aria-label="Zoom timeline in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
      </ControlTooltip>
    </div>
  );
  const framegrabControl = (
    <EditorFramegrabControl
      disabledReason={framegrabDisabledReason}
      onClick={onFramegrabClick}
    />
  );
  const pictureTools = (
    <div
      className="flex items-center gap-1.5"
      role="group"
      aria-label="Picture tools"
    >
      {framegrabControl}
      {onCropClick && (
        <ControlTooltip label="Crop video" disabled={cropDisabled}>
          <button
            type="button"
            onClick={onCropClick}
            disabled={cropDisabled}
            aria-label="Crop video"
            aria-pressed={cropActive}
            className={editorIconButtonClassName({
              className:
                "aria-pressed:bg-editor-control-active aria-pressed:text-foreground",
            })}
          >
            <Crop className="h-4 w-4" />
          </button>
        </ControlTooltip>
      )}
    </div>
  );
  const rangeActionButtonClassName =
    "editor-control-focus flex h-11 lg:h-8 items-center justify-center gap-1.5 px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45";
  const rangeActions = (
    <div className="flex items-center overflow-hidden rounded-[var(--radius-control)] border border-editor-border bg-editor-control">
      <ControlTooltip
        label="Set in point at the playhead"
        disabled={!canSetClipRange}
      >
        <button
          type="button"
          onClick={onSetInPoint}
          disabled={!canSetClipRange}
          className={rangeActionButtonClassName}
          aria-label="Set in point at the playhead"
        >
          Set in
        </button>
      </ControlTooltip>
      <ControlTooltip
        label="Set out point at the playhead"
        disabled={!canSetClipRange}
      >
        <button
          type="button"
          onClick={onSetOutPoint}
          disabled={!canSetClipRange}
          className={`${rangeActionButtonClassName} border-l border-editor-border`}
          aria-label="Set out point at the playhead"
        >
          Set out
        </button>
      </ControlTooltip>
      <ControlTooltip
        label="Clear in and out points"
        disabled={!canSetClipRange}
      >
        <button
          type="button"
          onClick={onClearPoints}
          disabled={!canSetClipRange}
          className={`${rangeActionButtonClassName} border-l border-editor-border`}
          aria-label="Clear in and out points"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Clear
        </button>
      </ControlTooltip>
    </div>
  );
  const editableClipMetrics = (
    <>
      {clipMetrics.map((metric) => {
        const label = (
          <span className="font-sans text-editor-property font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground lg:text-ui-label">
            {metric.label}
          </span>
        );
        return (
          <div
            key={metric.label}
            className={
              variant === "mobile"
                ? "col-span-2 grid min-h-11 min-w-0 grid-cols-subgrid items-center font-mono"
                : "flex items-center gap-2"
            }
          >
            {label}
            {metric.onCommit ? (
              <EditorEditableTimecode
                ariaLabel={`${metric.label} time`}
                tool="trim"
                className={
                  variant === "desktop" ? "font-mono text-sm" : undefined
                }
                disabled={!canEditClipTimecode}
                onCommit={metric.onCommit}
                style={variant === "desktop" ? clipMetricTimeStyle : undefined}
                value={metric.value}
              />
            ) : (
              <span
                className={`inline-block text-right font-mono text-sm font-semibold tabular-nums ${
                  metric.emphasized
                    ? "text-foreground"
                    : "text-muted-foreground"
                }`}
                style={variant === "desktop" ? clipMetricTimeStyle : undefined}
              >
                {formatTime(metric.value)}
              </span>
            )}
          </div>
        );
      })}
    </>
  );

  if (section === "trim") {
    return (
      <div className="space-y-2 p-3">
        <div
          className={
            variant === "mobile"
              ? "grid grid-cols-[auto_minmax(0,1fr)] gap-2"
              : "grid gap-2"
          }
        >
          {editableClipMetrics}
        </div>
        {rangeActions}
      </div>
    );
  }
  if (section === "playback") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <span className="text-sm">Preview volume</span>
        {volumeControl}
        <p className="w-full text-xs text-muted-foreground">
          Export audio settings are available in Export.
        </p>
      </div>
    );
  }
  if (variant === "mobile") {
    return (
      <div className="shrink-0 bg-editor-panel">
        <div className="flex min-h-12 flex-wrap items-center gap-1 px-2">
          <div className="@container min-w-0 flex-[1_0_min(100%,10rem)]">
            {previewTimeControl}
          </div>
          {playControl}
          {historyControls}
        </div>
        {!inspectorOpen && (
          <>
            <button
              type="button"
              onClick={onTrimClick}
              aria-label="Edit clip range"
              className="editor-control-focus flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 border-y border-editor-border px-3 py-1 text-xs tabular-nums"
            >
              <span>In {formatTime(startTime)}</span>
              <span>Out {formatTime(endTime)}</span>
              <span>{formatTime(endTime - startTime)} selected</span>
            </button>
            <div className="flex items-center justify-between px-2">
              <div className="flex">
                <button
                  type="button"
                  className={rangeActionButtonClassName}
                  disabled={!canSetClipRange}
                  onClick={onSetInPoint}
                  aria-label="Set in point at the playhead"
                >
                  Set in
                </button>
                <button
                  type="button"
                  className={rangeActionButtonClassName}
                  disabled={!canSetClipRange}
                  onClick={onSetOutPoint}
                  aria-label="Set out point at the playhead"
                >
                  Set out
                </button>
              </div>
              <Drawer>
                <DrawerTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Timeline view"
                      className={editorIconButtonClassName({
                        variant: "ghost",
                        className: "h-11 w-11",
                      })}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                    </button>
                  }
                />
                <DrawerContent className="border-editor-border bg-editor-panel">
                  <DrawerHeader>
                    <DrawerTitle>Timeline view</DrawerTitle>
                    <DrawerDescription>
                      Adjust the timeline scale and track labels.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-4 [&_button]:min-h-11 [&_button]:min-w-11">
                    {zoomControl}
                    <button
                      type="button"
                      onClick={onFitSelection}
                      disabled={!canSetClipRange || endTime <= startTime}
                      className={rangeActionButtonClassName}
                    >
                      Fit clip
                    </button>
                    <label className="flex min-h-11 w-full items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={trackNamesVisible}
                        onChange={(event) =>
                          onTrackNamesVisibleChange?.(event.target.checked)
                        }
                      />
                      Show track names
                    </label>
                  </div>
                </DrawerContent>
              </Drawer>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="border-b border-editor-border bg-editor-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2.5">
          {playControl}
          {previewTimeControl}
        </div>
        <div className="h-5 w-px bg-editor-border" />
        {volumeControl}
        {zoomControl}
        {pictureTools}
        {rangeActions}
        <div className="min-w-0 flex-1" />
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-right sm:gap-x-6">
          {editableClipMetrics}
        </div>
      </div>
    </div>
  );
});

export function EditorFramegrabControl({
  disabledReason,
  onClick,
  labelled = false,
}: {
  disabledReason: string | null;
  onClick: () => void;
  labelled?: boolean;
}) {
  return (
    <ControlTooltip
      label={disabledReason ?? "Export current frame"}
      disabled={Boolean(disabledReason)}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={Boolean(disabledReason)}
        className={editorIconButtonClassName({
          className: labelled ? "min-h-11 w-full gap-2 px-3" : undefined,
        })}
        data-editor-save-frame
        aria-label="Export current preview frame"
      >
        <Camera className="h-4 w-4" />
        {labelled && "Save frame"}
      </button>
    </ControlTooltip>
  );
}
