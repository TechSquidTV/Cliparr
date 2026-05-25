export type RefValue<T> = {
  current: T;
};

export interface PlaybackReadyRange {
  startTime: number;
  endTime: number;
  readyUntilTime: number;
  status: "idle" | "warming" | "ready";
}

export interface WarmClipSelectionOptions {
  extendToSelectionEnd?: boolean;
}
