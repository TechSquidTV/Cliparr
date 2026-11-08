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
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-end lg:gap-4">
      <div
        role="status"
        className="min-w-0 max-h-[24dvh] overflow-y-auto wrap-anywhere text-sm text-muted-foreground empty:sr-only lg:mr-auto"
      >
        {message && (
          <p className={error ? "text-destructive" : undefined}>{message}</p>
        )}
        {!exporting && <ExportMemoryGuidance bytes={estimate.bytes} />}
      </div>
      {!exporting && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm lg:shrink-0">
          <span className="text-muted-foreground">Estimated file size</span>
          <span className="font-mono font-semibold tabular-nums text-foreground">
            {formatExportSizeEstimate(estimate)}
          </span>
        </div>
      )}
    </div>
  );
}
