import * as React from "react";

import type { MediaDimensions } from "#/components/editor/editorMedia";
import { formatTime } from "#/components/editor/editorUtilities";
import { gifPresetOptionFor } from "#/components/export/exportOptions";
import { fieldLabelWideClasses } from "#/components/ui/control-styles";
import { cn } from "#/lib/cn";
import type { ExportAudioPlan } from "#/lib/export/exportAudio";
import type { ExportFormat } from "#/lib/export/exportClip";
import {
  exportFormatFor,
  exportIncludesAudio,
  type ExportMode,
  isAudioExportFormat,
} from "#/lib/export/exportFormats";
import {
  exportQualityOptionFor,
  type ExportQualityPreset,
  type GifExportSettings,
} from "#/lib/export/exportTypes";
export function ExportSummaryPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="border-b border-border pb-2">
        <div className={fieldLabelWideClasses}>Summary</div>
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      <dl className="grid gap-2 text-sm">{children}</dl>
    </aside>
  );
}
export function ExportSummaryItem({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-background px-3 py-2",
        className,
      )}
    >
      <dt className={fieldLabelWideClasses}>{label}</dt>
      {children}
    </div>
  );
}
export function ExportDurationSummary({ seconds }: { seconds: number }) {
  return (
    <ExportSummaryItem label="Duration">
      <dd className="mt-1 font-mono text-xs text-foreground">
        {formatTime(Math.max(0, seconds))}
      </dd>
    </ExportSummaryItem>
  );
}
export interface ExportOutputSummaryProperties {
  selectedFormat: ExportFormat;
  selectedQuality: ExportQualityPreset;
  gifSettings?: GifExportSettings | null;
  outputDimensions: MediaDimensions | null;
  mode: ExportMode;
  audioStatus: string;
  audioPlan: ExportAudioPlan | null;
}
export function ExportOutputSummary({
  selectedFormat,
  selectedQuality,
  gifSettings,
  outputDimensions,
  mode,
  audioStatus,
  audioPlan,
}: ExportOutputSummaryProperties) {
  const selectedFormatOption = exportFormatFor(selectedFormat);
  const audioOnly = isAudioExportFormat(selectedFormat);
  let outputDetail = `${exportQualityOptionFor(selectedQuality).label} quality`;
  if (selectedFormat === "gif" && gifSettings) {
    outputDetail = `${gifPresetOptionFor(gifSettings.preset).label} GIF / ${gifSettings.frameRate} fps`;
  }
  return (
    <>
      <ExportSummaryItem label="Output">
        <dd className="mt-1 text-xs text-foreground">
          {selectedFormatOption.label}
        </dd>
        {!audioOnly && (
          <dd className="mt-1 font-mono text-ui-label text-foreground">
            {outputDimensions
              ? `${outputDimensions.width} x ${outputDimensions.height}`
              : "Unknown size"}
          </dd>
        )}
        {audioOnly ? (
          <dd className="mt-2">
            <ExportAudioDetails
              plan={audioPlan}
              status={audioStatus}
              showCodec={selectedFormat === "wav"}
            />
          </dd>
        ) : (
          <dd className="mt-1 text-ui-label text-muted-foreground">
            {outputDetail}
          </dd>
        )}
      </ExportSummaryItem>

      {!audioOnly && selectedFormat !== "gif" && (
        <ExportSummaryItem label="Audio">
          <dd className="mt-2">
            <ExportAudioDetails
              plan={audioPlan}
              status={
                exportIncludesAudio(mode, selectedFormat)
                  ? audioStatus
                  : "Video only"
              }
              showCodec
            />
          </dd>
        </ExportSummaryItem>
      )}
    </>
  );
}
function ExportAudioDetails({
  plan,
  status,
  showCodec,
}: {
  plan: ExportAudioPlan | null;
  status: string;
  showCodec: boolean;
}) {
  if (!plan) {
    return <p className="text-xs text-muted-foreground">{status}</p>;
  }
  const details: Array<readonly [string, string]> = [];
  if (showCodec) {
    let codec = plan.codec === "opus" ? "Opus" : plan.codec.toUpperCase();
    if (plan.codec.startsWith("pcm-")) {
      codec = plan.codec === "pcm-f32" ? "PCM (float)" : "PCM";
    }
    details.push(["Codec", codec]);
  }
  details.push(
    [
      "Channels",
      { 1: "Mono", 2: "Stereo" }[plan.numberOfChannels] ??
        `${plan.numberOfChannels} channels`,
    ],
    ["Sample rate", `${plan.sampleRate / 1000} kHz`],
  );
  if (plan.bits !== null) {
    details.push(["Bit depth", `${plan.bits}-bit`]);
  } else if (plan.bitrate !== undefined) {
    details.push(["Bitrate", `${plan.bitrate / 1000} kbps`]);
  }
  return (
    <>
      <dl className="space-y-1 text-xs">
        {details.map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {plan.sampleRate !== plan.source.sampleRate && (
        <p className="mt-2 text-xs text-muted-foreground">
          Resampled from {plan.source.sampleRate / 1000} kHz.
        </p>
      )}
    </>
  );
}
