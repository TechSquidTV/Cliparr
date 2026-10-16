import type { ExportPhase } from "#/lib/export/exportClip";
import {
  type ExportSizeEstimate,
  formatExportSizeEstimate,
} from "#/lib/export/exportTypes";

function ExportMemoryGuidance({ bytes }: { bytes: number | null }) {
  return bytes !== null && bytes >= 100 * 1024 * 1024 ? (
    <p className="mt-1 text-xs text-muted-foreground">
      Large export uses browser memory. Shorter clips use less.
    </p>
  ) : null;
}

export function ExportStatusPanel({
  estimate,
  exporting,
  phase,
  progress,
  notice,
  error,
  disabledReason,
}: {
  estimate: ExportSizeEstimate;
  exporting: boolean;
  phase: ExportPhase;
  progress: number;
  notice: string | null;
  error: string | null;
  disabledReason?: string | null;
}) {
  const phaseLabel = {
    preparing: "Preparing media…",
    encoding: `Encoding: ${Math.round(progress * 100)}%`,
    finalizing: "Finalizing file…",
  }[phase];
  const message = exporting ? phaseLabel : (error ?? disabledReason ?? notice);
  return (
    <div className="h-28 min-w-0 overflow-y-auto self-stretch sm:h-20 sm:flex-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">Estimated size</span>
        <span className="font-mono tabular-nums text-foreground">
          {formatExportSizeEstimate(estimate)}
        </span>
      </div>
      <div
        role="status"
        className={`mt-1 wrap-anywhere text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
      >
        {message}
      </div>
      <ExportMemoryGuidance bytes={estimate.bytes} />
    </div>
  );
}
