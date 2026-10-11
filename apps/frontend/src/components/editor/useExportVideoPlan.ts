import { useEffect, useState } from "react";
import { canEncodeVideo } from "mediabunny";
import {
  isAudioExportFormat,
  type ExportFormat,
} from "#/lib/export/exportFormats";
import {
  exportVideoCodecPriorities,
  resolveVideoEncodingPlan,
  videoEncodingPlanKey,
  type ResolvedVideoEncodingPlan,
} from "#/lib/export/exportEncodingPolicy";
import type {
  ExportOutputDimensions,
  VideoExportQualityPreset,
} from "#/lib/export/exportTypes";

/** Advisory plan for estimates; conversion validates support again at export time. */
export function useExportVideoPlan(
  format: ExportFormat,
  outputDimensions: ExportOutputDimensions | null,
  quality: VideoExportQualityPreset,
) {
  const [result, setResult] = useState<ResolvedVideoEncodingPlan | null>(null);
  const key =
    !isAudioExportFormat(format) && format !== "gif" && outputDimensions
      ? videoEncodingPlanKey({ format, outputDimensions, quality })
      : null;

  useEffect(() => {
    if (
      isAudioExportFormat(format) ||
      format === "gif" ||
      !outputDimensions ||
      !key
    ) {
      return;
    }
    let cancelled = false;
    void resolveVideoEncodingPlan({
      format,
      outputDimensions,
      quality,
      supportedVideoCodecs: exportVideoCodecPriorities(format),
      canEncodeVideo,
    })
      .then((plan) => {
        if (!cancelled) {
          setResult({ ...plan, key });
        }
      })
      .catch(() => {
        // An unavailable advisory plan must not block a possible video copy.
      });
    return () => {
      cancelled = true;
    };
  }, [format, outputDimensions, quality, key]);

  return result?.key === key ? result : null;
}
