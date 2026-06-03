import type { ExportFormat } from "@/lib/exportTypes";

interface EditorExportOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

export const formatOptions: ReadonlyArray<
  EditorExportOption<ExportFormat> & {
    extension: string;
  }
> = [
  {
    value: "mp4",
    label: "MP4",
    extension: ".mp4",
    description: "Best for sharing and uploads.",
  },
  {
    value: "webm",
    label: "WEBM",
    extension: ".webm",
    description: "Modern animated web playback.",
  },
  {
    value: "gif",
    label: "GIF",
    extension: ".gif",
    description: "Animated image export for short clips.",
  },
  {
    value: "mov",
    label: "MOV",
    extension: ".mov",
    description: "Good for editing workflows.",
  },
  {
    value: "mkv",
    label: "MKV",
    extension: ".mkv",
    description: "Flexible container support.",
  },
];

export function formatOptionFor(format: ExportFormat) {
  return (
    formatOptions.find((option) => option.value === format) ?? formatOptions[0]
  );
}
