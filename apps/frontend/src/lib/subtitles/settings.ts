import type { SubtitleStyleSettings } from "./types";

const SUBTITLE_STYLE_SETTINGS_STORAGE_KEY = "cliparr.subtitle.style-settings.v1";

export const SUBTITLE_FONT_OPTIONS = [
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Trebuchet MS", value: "\"Trebuchet MS\", sans-serif" },
  { label: "Tahoma", value: "Tahoma, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "\"Times New Roman\", serif" },
  { label: "Courier New", value: "\"Courier New\", monospace" },
] as const;

export function defaultSubtitleStyleSettings(): SubtitleStyleSettings {
  return {
    fontFamily: SUBTITLE_FONT_OPTIONS[0].value,
    fontSize: 42,
    fontColor: "#ffffff",
    shadowColor: "#000000",
    shadowBlur: 6,
    shadowOffsetY: 2,
    strokeColor: "#000000",
    strokeWidth: 4,
    bottomMargin: 72,
    lineHeight: 1.2,
  };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function colorValue(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim()
    : fallback;
}

export function loadSubtitleStyleSettings(): SubtitleStyleSettings {
  const defaults = defaultSubtitleStyleSettings();

  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(SUBTITLE_STYLE_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as Partial<SubtitleStyleSettings>;

    return {
      fontFamily: typeof parsed.fontFamily === "string" && parsed.fontFamily.trim()
        ? parsed.fontFamily
        : defaults.fontFamily,
      fontSize: clampNumber(parsed.fontSize, defaults.fontSize, 16, 120),
      fontColor: colorValue(parsed.fontColor, defaults.fontColor),
      shadowColor: colorValue(parsed.shadowColor, defaults.shadowColor),
      shadowBlur: clampNumber(parsed.shadowBlur, defaults.shadowBlur, 0, 24),
      shadowOffsetY: clampNumber(parsed.shadowOffsetY, defaults.shadowOffsetY, -16, 24),
      strokeColor: colorValue(parsed.strokeColor, defaults.strokeColor),
      strokeWidth: clampNumber(parsed.strokeWidth, defaults.strokeWidth, 0, 16),
      bottomMargin: clampNumber(parsed.bottomMargin, defaults.bottomMargin, 0, 240),
      lineHeight: clampNumber(parsed.lineHeight, defaults.lineHeight, 1, 2),
    };
  } catch {
    return defaults;
  }
}

export function saveSubtitleStyleSettings(settings: SubtitleStyleSettings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SUBTITLE_STYLE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort persistence only.
  }
}
