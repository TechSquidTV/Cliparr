const SIZE_UNIT_PERCENT = "%";
const SIZE_UNIT_REM = "rem";

function percentSize(value: number) {
  return `${value}${SIZE_UNIT_PERCENT}`;
}

function remSize(value: number) {
  return `${value}${SIZE_UNIT_REM}`;
}

// react-resizable-panels parses these unit strings itself, so CSS vars cannot
// be passed directly here. Keep the editor geometry named and centralized.
export const EDITOR_DESKTOP_LAYOUT_QUERY = `(min-width: ${remSize(64)})`;

export const EDITOR_RESIZE_TARGET_MINIMUM_SIZE = {
  coarse: 36,
  fine: 8,
} as const;

export const EDITOR_PANEL_SIZES = {
  primaryOpen: percentSize(73),
  primaryClosed: percentSize(97),
  primaryMin: remSize(40),
  previewDefault: percentSize(68),
  previewMin: remSize(10),
  timelineDefault: percentSize(32),
  timelineMin: remSize(13),
  timelineMax: percentSize(60),
  propertiesDefault: percentSize(27),
  propertiesMin: remSize(18),
  propertiesMax: remSize(34),
  propertiesRail: remSize(3),
} as const;
