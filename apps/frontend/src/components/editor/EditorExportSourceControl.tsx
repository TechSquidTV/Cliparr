import { Info } from "lucide-react";

import type { ExportOption } from "#/components/export/exportOptions";
import { exportHelperTextClassName } from "#/components/export/ExportSectionHeader";
import { fieldLabelWideClasses } from "#/components/ui/control-styles";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { type ExportSourcePreference } from "#/lib/export/exportTypes";
function sourceOptionsFor(labels: {
  directSourceLabel: string;
  hlsSourceLabel: string;
}): ReadonlyArray<ExportOption<ExportSourcePreference>> {
  return [
    {
      value: "auto",
      label: "Auto",
      description: "Chooses the best available path.",
    },
    {
      value: "direct",
      label: labels.directSourceLabel,
      description: "Uses direct media when available.",
    },
    {
      value: "hls",
      label: labels.hlsSourceLabel,
      description: "Uses the playback stream.",
    },
  ];
}

export function EditorExportSourceControl({
  selectedSourcePreference,
  onSourcePreferenceChange,
  hasHlsSource,
  hasDirectSource,
  directSourceLabel,
  hlsSourceLabel,
}: {
  selectedSourcePreference: ExportSourcePreference;
  onSourcePreferenceChange: (preference: ExportSourcePreference) => void;
  hasHlsSource: boolean;
  hasDirectSource: boolean;
  directSourceLabel: string;
  hlsSourceLabel: string;
}) {
  const sourceOptions = sourceOptionsFor({ directSourceLabel, hlsSourceLabel });
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className={fieldLabelWideClasses}>Source</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Export source details"
                className="control-focus inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            }
          />
          <TooltipContent side="top" align="start">
            Chooses the media path used for export.
          </TooltipContent>
        </Tooltip>
      </div>
      <Select
        value={selectedSourcePreference}
        items={sourceOptions}
        onValueChange={(value) => {
          if (value !== null) {
            onSourcePreferenceChange?.(value);
          }
        }}
      >
        <SelectTrigger size="sm">
          <SelectValue placeholder="Select source" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Sources</SelectLabel>
            {sourceOptions.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={
                  (option.value === "direct" && !hasDirectSource) ||
                  (option.value === "hls" && !hasHlsSource)
                }
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <p className={exportHelperTextClassName}>
        {
          (
            sourceOptions.find(
              (option) => option.value === selectedSourcePreference,
            ) ?? sourceOptions[0]
          ).description
        }
      </p>
    </div>
  );
}
