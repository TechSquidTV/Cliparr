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

export interface CapturePlan {
  scenes: CaptureScene[];
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
  heroSeconds?: string;
  mobileSeconds?: string;
  heroSubtitle?: string;
  mobileSubtitle?: string;
}): CaptureScene[] {
  return [
    {
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
    },
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
