import type { CSSProperties } from "react";
import type { SubtitleStyleSettings } from "../../lib/subtitles/types";

interface EditorSubtitleStylePreviewProps {
  subtitleStyleSettings: SubtitleStyleSettings;
}

function relativeLuminance(color: string) {
  const normalized = color.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return 1;
  }

  const rgb = [
    normalized.slice(0, 2),
    normalized.slice(2, 4),
    normalized.slice(4, 6),
  ].map((segment) => parseInt(segment, 16) / 255);

  const linearRgb = rgb.map((channel) => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));

  return (0.2126 * linearRgb[0]) + (0.7152 * linearRgb[1]) + (0.0722 * linearRgb[2]);
}

export function EditorSubtitleStylePreview({
  subtitleStyleSettings,
}: EditorSubtitleStylePreviewProps) {
  const darkText = relativeLuminance(subtitleStyleSettings.fontColor) < 0.18;

  const sampleStyle: CSSProperties = {
    fontFamily: subtitleStyleSettings.fontFamily,
    color: subtitleStyleSettings.fontColor,
    textShadow: `0 ${subtitleStyleSettings.shadowOffsetY}px ${subtitleStyleSettings.shadowBlur}px ${subtitleStyleSettings.shadowColor}`,
    WebkitTextStroke: `${subtitleStyleSettings.strokeWidth}px ${subtitleStyleSettings.strokeColor}`,
  };

  const captionPlateStyle: CSSProperties = {
    background: darkText
      ? "color-mix(in oklch, white 82%, transparent)"
      : "color-mix(in oklch, black 34%, transparent)",
    borderColor: darkText
      ? "color-mix(in oklch, white 78%, transparent)"
      : "color-mix(in oklch, white 16%, transparent)",
    boxShadow: darkText
      ? "0 12px 26px color-mix(in oklch, black 14%, transparent)"
      : "0 12px 26px color-mix(in oklch, black 34%, transparent)",
  };

  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
        Style Preview
      </div>
      <div className="overflow-hidden border border-sidebar-border bg-[linear-gradient(180deg,color-mix(in_oklch,var(--sidebar-background)_86%,var(--sidebar-accent))_0%,color-mix(in_oklch,var(--sidebar-accent)_88%,var(--sidebar-background))_62%,color-mix(in_oklch,var(--sidebar-primary)_10%,var(--sidebar-accent))_100%)]">
        <div className="relative h-36 px-4 py-5">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-[radial-gradient(circle_at_50%_92%,color-mix(in_oklch,var(--sidebar-primary)_16%,transparent)_0%,transparent_68%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--sidebar-foreground)_8%,transparent),transparent)]" />

          <div className="absolute inset-x-4 bottom-4 flex justify-center">
            <div
              style={captionPlateStyle}
              className="max-w-full border px-4 py-2 backdrop-blur-sm"
            >
              <div
                style={sampleStyle}
                className="text-center text-xl font-bold leading-tight"
              >
                This is what your subtitles will look like
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
