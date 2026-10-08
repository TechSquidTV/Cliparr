import type { AssetCaptureSelection } from "@cliparr/shared/asset-capture";

export interface CaptureScene {
  name: "hero" | "mobile";
  mediaPath: string;
  viewport: { width: number; height: number };
  selection: AssetCaptureSelection;
  recordingSeconds: number;
  videoName: string;
  posterName: string;
  targetBytes: number;
}

export type CaptureTarget = "all" | "readme-social";

export interface CapturePlan {
  target: CaptureTarget;
  scenes: CaptureScene[];
}

export const readmeSocialCapture = {
  viewport: { width: 1600, height: 840 },
  offsetSeconds: 0.65,
  social: { width: 1200, height: 630 },
} as const;

export function captureTarget(value: string): CaptureTarget {
  if (value !== "all" && value !== "readme-social") {
    throw new Error("--target must be all or readme-social.");
  }
  return value;
}

export function readmeSocialSeconds(scene: CaptureScene) {
  const seconds = scene.selection.inSeconds + readmeSocialCapture.offsetSeconds;
  if (
    !Number.isFinite(seconds) ||
    seconds < scene.selection.inSeconds ||
    seconds >= scene.selection.outSeconds
  ) {
    throw new Error(
      "README/social frame must be inside the selected source range.",
    );
  }
  return seconds;
}

export function recordingDuration(
  value: string | undefined,
  fallback: number,
  selectionSeconds: number,
) {
  const duration = value === undefined ? fallback : Number(value);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > selectionSeconds
  ) {
    throw new Error(
      `Recording duration must be positive and no longer than the selected ${selectionSeconds} seconds.`,
    );
  }
  return duration;
}

export function buildScenes(options: {
  hero: string;
  mobile: string;
  target?: CaptureTarget;
  heroSeconds?: string;
  mobileSeconds?: string;
  heroSubtitle?: string;
  mobileSubtitle?: string;
}): CaptureScene[] {
  const hero: CaptureScene = {
    name: "hero",
    mediaPath: options.hero,
    viewport: { width: 1600, height: 886 },
    selection: {
      inSeconds: 496.07,
      outSeconds: 499.01,
      subtitleFontSize: 72,
      ...(options.heroSubtitle
        ? { subtitleTrackKey: options.heroSubtitle }
        : {}),
    },
    recordingSeconds: recordingDuration(options.heroSeconds, 82 / 30, 2.94),
    videoName: "preview",
    posterName: "screenshot",
    targetBytes: 500_000,
  };
  if (options.target === "readme-social") {
    return [hero];
  }
  return [
    hero,
    {
      name: "mobile",
      mediaPath: options.mobile,
      viewport: { width: 402, height: 874 },
      selection: {
        inSeconds: 1402,
        outSeconds: 1412,
        subtitleFontSize: 150,
        ...(options.mobileSubtitle
          ? { subtitleTrackKey: options.mobileSubtitle }
          : {}),
      },
      recordingSeconds: recordingDuration(options.mobileSeconds, 3, 10),
      videoName: "mobile-pwa-preview",
      posterName: "mobile-pwa-preview",
      targetBytes: 100_000,
    },
  ];
}
