import { useMemo, type CSSProperties, type ReactElement } from "react";
import {
  Camera,
  Pause,
  Play,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { EditorEditableTimecode } from "@/components/editor/EditorEditableTimecode";
import { EditorPreviewTimecode } from "@/components/editor/EditorPreviewTimecode";
import {
  formatTime,
  formatTimecodeInput,
} from "@/components/editor/editorUtils";

type EditorControlsVariant = "desktop" | "mobile";

interface EditorControlsProps {
  variant?: EditorControlsVariant;
  playing: boolean;
  loadingPreview: boolean;
  togglePlay: () => void;
  currentTime: number;
  duration: number;
  startTime: number;
  endTime: number;
  muted: boolean;
  setMuted: (muted: boolean | ((prev: boolean) => boolean)) => void;
  volume: number;
  setVolume: (volume: number) => void;
  handleTimelineZoomIn: () => void;
  handleTimelineZoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onFramegrabClick: () => void;
  framegrabDisabledReason: string | null;
  onPreviewTimeCommit: (time: number) => void | Promise<void>;
  onStartTimeCommit: (time: number) => void | Promise<void>;
  onEndTimeCommit: (time: number) => void | Promise<void>;
}

function ControlTooltip({
  label,
  disabled = false,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span className="inline-flex" tabIndex={0}>
            {children}
          </span>
        ) : (
          children
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function EditorControls({
  variant = "desktop",
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
  onPreviewTimeCommit,
  onStartTimeCommit,
  onEndTimeCommit,
}: EditorControlsProps) {
  const hasDuration = duration > 0;
  const canEditPreviewTime = !loadingPreview && hasDuration;
  const canEditClipRange = !loadingPreview && !playing && hasDuration;
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
      width: `${Math.max(7, formatTimecodeInput(duration).length)}ch`,
    }),
    [duration],
  );
  const volumeRangeFillPercent = `${
    Math.min(Math.max(muted ? 0 : volume, 0), 1) * 100
  }%`;
  const framegrabDisabled = Boolean(framegrabDisabledReason);
  const playControl = (
    <ControlTooltip
      label={
        loadingPreview
          ? "Preview is loading."
          : playing
            ? "Pause preview"
            : "Play preview"
      }
      disabled={loadingPreview}
    >
      <button
        type="button"
        onClick={togglePlay}
        disabled={loadingPreview}
        aria-label={playing ? "Pause preview" : "Play preview"}
        className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-editor-border bg-editor-control text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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
      buttonClassName="rounded-[var(--radius-control)] px-1 text-foreground hover:bg-editor-control-hover focus-visible:ring-editor-accent/35"
      disabled={!canEditPreviewTime}
      onCommit={onPreviewTimeCommit}
      value={currentTime}
      valueLabel={`${formatTimecodeInput(currentTime)} of ${formatTimecodeInput(duration)}`}
    >
      <EditorPreviewTimecode
        ariaHidden
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
          className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-editor-border bg-editor-control text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none"
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
        className="cliparr-editor-range w-24 sm:w-28"
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
          className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
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
          className="flex h-8 w-8 items-center justify-center border-l border-editor-border text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
          aria-label="Zoom timeline in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
      </ControlTooltip>
    </div>
  );
  const framegrabControl = (
    <ControlTooltip
      label={framegrabDisabledReason ?? "Export current frame"}
      disabled={framegrabDisabled}
    >
      <button
        type="button"
        onClick={onFramegrabClick}
        disabled={framegrabDisabled}
        className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-editor-border bg-editor-control text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
        aria-label="Export current preview frame"
      >
        <Camera className="h-4 w-4" />
      </button>
    </ControlTooltip>
  );
  const editableClipMetrics = (
    <>
      {clipMetrics.map((metric) => (
        <div key={metric.label} className="flex items-center gap-2">
          <span className="text-ui-label font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
            {metric.label}
          </span>
          {metric.onCommit ? (
            <EditorEditableTimecode
              ariaLabel={`${metric.label} time`}
              buttonClassName="w-full justify-end rounded-[var(--radius-control)] px-1 font-mono text-sm font-semibold tabular-nums text-muted-foreground hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-editor-accent/35"
              className="justify-end"
              disabled={!canEditClipRange}
              inputClassName="text-right"
              onCommit={metric.onCommit}
              style={clipMetricTimeStyle}
              value={metric.value}
            >
              <span className="block w-full text-right">
                {formatTime(metric.value)}
              </span>
            </EditorEditableTimecode>
          ) : (
            <span
              className={`inline-block text-right font-mono text-sm font-semibold tabular-nums ${
                metric.emphasized ? "text-foreground" : "text-muted-foreground"
              }`}
              style={clipMetricTimeStyle}
            >
              {formatTime(metric.value)}
            </span>
          )}
        </div>
      ))}
    </>
  );

  if (variant === "mobile") {
    return (
      <div className="border-b border-editor-border bg-editor-panel px-3 py-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
          <div className="[&_button]:h-10 [&_button]:w-10">{playControl}</div>
          <div className="min-w-0 text-center text-sm font-medium">
            {previewTimeControl}
          </div>
          <Drawer>
            <DrawerTrigger asChild>
              <button
                type="button"
                aria-label="More clip controls"
                className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] border border-editor-border bg-editor-control text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </DrawerTrigger>
            <DrawerContent className="border-editor-border bg-editor-panel text-sidebar-foreground">
              <DrawerHeader className="border-b border-editor-border px-3 text-left">
                <DrawerTitle>Clip Controls</DrawerTitle>
                <DrawerDescription className="sr-only">
                  Additional clip controls
                </DrawerDescription>
              </DrawerHeader>
              <div className="cliparr-editor-scrollbar min-h-0 overflow-y-auto px-3 pb-4">
                <section className="border-b border-editor-border py-3">
                  <div className="mb-2 text-ui-micro font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
                    Playback
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-sidebar-foreground">
                      Volume
                    </span>
                    <div className="[&_input]:w-36">{volumeControl}</div>
                  </div>
                </section>
                <section className="border-b border-editor-border py-3">
                  <div className="mb-2 text-ui-micro font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
                    Timeline
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-sidebar-foreground">
                      Zoom
                    </span>
                    {zoomControl}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-sidebar-foreground">
                      Frame
                    </span>
                    {framegrabControl}
                  </div>
                </section>
                <section className="py-3">
                  <div className="mb-2 text-ui-micro font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
                    Clip Range
                  </div>
                  <div className="grid gap-2 text-right">
                    {editableClipMetrics}
                  </div>
                </section>
              </div>
            </DrawerContent>
          </Drawer>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {clipMetrics.map((metric) => (
            <div
              key={metric.label}
              className="min-w-0 rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2 py-1.5"
            >
              <div className="truncate text-ui-micro font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground">
                {metric.label}
              </div>
              <div
                className={`truncate font-mono text-xs font-semibold ${
                  metric.emphasized
                    ? "text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {formatTime(metric.value)}
              </div>
            </div>
          ))}
        </div>
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
        {framegrabControl}
        <div className="min-w-0 flex-1" />
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-right sm:gap-x-6">
          {editableClipMetrics}
        </div>
      </div>
    </div>
  );
}
