import type { SubtitleStyleSettings } from "./types";

const SUBTITLE_STYLE_SETTINGS_STORAGE_KEY = "cliparr.subtitle.style-settings.v1";

export type SubtitleFontOptionSource = "bundled" | "local" | "saved";

export interface SubtitleFontOption {
  label: string;
  value: string;
  source: SubtitleFontOptionSource;
}

interface LocalFontData {
  family: string;
}

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<readonly LocalFontData[]>;
};

let localSubtitleFontOptionsPromise: Promise<readonly SubtitleFontOption[]> | null = null;

export const SUBTITLE_FONT_OPTIONS: readonly SubtitleFontOption[] = [
  { label: "Arial", value: "Arial, sans-serif", source: "bundled" },
  { label: "Verdana", value: "Verdana, sans-serif", source: "bundled" },
  { label: "Trebuchet MS", value: "\"Trebuchet MS\", sans-serif", source: "bundled" },
  { label: "Tahoma", value: "Tahoma, sans-serif", source: "bundled" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif", source: "bundled" },
  { label: "Georgia", value: "Georgia, serif", source: "bundled" },
  { label: "Times New Roman", value: "\"Times New Roman\", serif", source: "bundled" },
  { label: "Courier New", value: "\"Courier New\", monospace", source: "bundled" },
];

function normalizeFontLabel(value: string) {
  return value.trim().replace(/^['"]+|['"]+$/g, "").toLowerCase();
}

function subtitleFontLabelFromValue(fontFamily: string) {
  const trimmed = fontFamily.trim();
  if (!trimmed) {
    return "Custom Font";
  }

  const builtInOption = SUBTITLE_FONT_OPTIONS.find((option) => option.value === trimmed);
  if (builtInOption) {
    return builtInOption.label;
  }

  const firstFamily = trimmed.split(",")[0]?.trim() ?? "";
  const normalized = firstFamily.replace(/^['"]+|['"]+$/g, "");

  return normalized || trimmed;
}

export function createSubtitleFontOptionFromValue(
  fontFamily: string,
  existingOptions: readonly SubtitleFontOption[] = []
): SubtitleFontOption | null {
  const trimmed = fontFamily.trim();
  if (!trimmed) {
    return null;
  }

  if (existingOptions.some((option) => option.value === trimmed)) {
    return null;
  }

  return {
    label: `${subtitleFontLabelFromValue(trimmed)} (Current)`,
    value: trimmed,
    source: "saved",
  };
}

export function loadLocalSubtitleFontOptions(): Promise<readonly SubtitleFontOption[]> {
  if (typeof window === "undefined") {
    return Promise.resolve([]);
  }

  if (localSubtitleFontOptionsPromise) {
    return localSubtitleFontOptionsPromise;
  }

  const localFontWindow = window as LocalFontWindow;

  if (typeof localFontWindow.queryLocalFonts !== "function") {
    localSubtitleFontOptionsPromise = Promise.resolve([]);
    return localSubtitleFontOptionsPromise;
  }

  const bundledLabels = new Set(
    SUBTITLE_FONT_OPTIONS.map((option) => normalizeFontLabel(option.label))
  );

  localSubtitleFontOptionsPromise = localFontWindow.queryLocalFonts()
    .then((fonts) => {
      const seenLabels = new Set<string>();
      const options: SubtitleFontOption[] = [];

      for (const font of fonts) {
        const family = font.family?.trim();
        if (!family) {
          continue;
        }

        const normalizedLabel = normalizeFontLabel(family);
        if (!normalizedLabel || bundledLabels.has(normalizedLabel) || seenLabels.has(normalizedLabel)) {
          continue;
        }

        seenLabels.add(normalizedLabel);
        options.push({
          label: family,
          value: JSON.stringify(family),
          source: "local",
        });
      }

      return options.sort((left, right) => left.label.localeCompare(right.label));
    })
    .catch(() => []);

  return localSubtitleFontOptionsPromise;
}

function defaultSubtitleStyleSettings(): SubtitleStyleSettings {
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
