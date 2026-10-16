import {
  ExportDurationSummary,
  ExportOutputSummary,
  ExportSummaryPanel,
} from "@cliparr/frontend/convert/ui";
import type { ComponentProps } from "react";

export function ConvertExportSummary({
  title,
  duration,
  ...output
}: ComponentProps<typeof ExportOutputSummary> & {
  title: string;
  duration: number;
}) {
  return (
    <ExportSummaryPanel title={title}>
      <ExportDurationSummary seconds={duration} />
      <ExportOutputSummary {...output} />
    </ExportSummaryPanel>
  );
}
