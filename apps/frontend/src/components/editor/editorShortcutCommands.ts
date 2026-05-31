export const EDITOR_LARGE_SEEK_SECONDS = 30;
export const EDITOR_SMALL_SEEK_SECONDS = 5;
export const DEFAULT_EDITOR_FRAME_STEP_SECONDS = 1 / 30;

export type EditorShortcutCommand =
  | "toggle-play"
  | "mark-in"
  | "mark-out"
  | "jump-to-in"
  | "jump-to-out"
  | "seek-backward-large"
  | "seek-forward-large"
  | "seek-backward-small"
  | "seek-forward-small"
  | "step-frame-backward"
  | "step-frame-forward"
  | "zoom-out"
  | "zoom-in";

export interface EditorShortcutEvent {
  code: string;
  repeat?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  pressedCodes?: ReadonlySet<string>;
}

export function resolveEditorShortcutCommand({
  code,
  repeat = false,
  shiftKey = false,
  altKey = false,
  ctrlKey = false,
  metaKey = false,
  pressedCodes,
}: EditorShortcutEvent): EditorShortcutCommand | null {
  if (altKey || ctrlKey || metaKey) {
    return null;
  }

  const kHeld = pressedCodes?.has("KeyK") ?? false;
  if (kHeld && code === "KeyJ") {
    return "step-frame-backward";
  }
  if (kHeld && code === "KeyL") {
    return "step-frame-forward";
  }

  switch (code) {
    case "Space":
      return repeat || shiftKey ? null : "toggle-play";
    case "KeyI":
      if (repeat) return null;
      return shiftKey ? "jump-to-in" : "mark-in";
    case "KeyO":
      if (repeat) return null;
      return shiftKey ? "jump-to-out" : "mark-out";
    case "BracketLeft":
      return repeat || shiftKey ? null : "mark-in";
    case "BracketRight":
      return repeat || shiftKey ? null : "mark-out";
    case "ArrowLeft":
      return shiftKey ? "seek-backward-small" : "seek-backward-large";
    case "ArrowRight":
      return shiftKey ? "seek-forward-small" : "seek-forward-large";
    case "PageUp":
      return "step-frame-backward";
    case "PageDown":
      return "step-frame-forward";
    case "Minus":
      return "zoom-out";
    case "Equal":
      return "zoom-in";
    default:
      return null;
  }
}

export function resolveRelativeSeekTime({
  currentTime,
  deltaSeconds,
  duration,
}: {
  currentTime: number;
  deltaSeconds: number;
  duration: number;
}) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0;
  }

  const safeCurrentTime = Number.isFinite(currentTime) ? currentTime : 0;
  const safeDeltaSeconds = Number.isFinite(deltaSeconds) ? deltaSeconds : 0;

  return Math.min(duration, Math.max(0, safeCurrentTime + safeDeltaSeconds));
}

export function frameStepSecondsFromFrameRate(frameRate: number | null) {
  if (!Number.isFinite(frameRate) || frameRate === null || frameRate <= 0) {
    return DEFAULT_EDITOR_FRAME_STEP_SECONDS;
  }

  return 1 / frameRate;
}
