import type { ExportResolution } from "#/lib/export/exportClip";
import {
  type GifExportPreset,
  gifExportPresetOptions,
} from "#/lib/export/exportTypes";

export interface ExportOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

export const resolutionOptions: ReadonlyArray<ExportOption<ExportResolution>> =
  [
    {
      value: "original",
      label: "Original",
      description: "Keeps the source dimensions when possible.",
    },
    {
      value: "1080",
      label: "1080p",
      description: "Balanced delivery size for full HD exports.",
    },
    {
      value: "720",
      label: "720p",
      description: "Lighter output for faster downloads and sharing.",
    },
  ];

export function resolutionOptionFor(resolution: ExportResolution) {
  return (
    resolutionOptions.find((option) => option.value === resolution) ??
    resolutionOptions[0]
  );
}

export function gifPresetOptionFor(preset: GifExportPreset) {
  return (
    gifExportPresetOptions.find((option) => option.value === preset) ??
    gifExportPresetOptions[0]
  );
}
