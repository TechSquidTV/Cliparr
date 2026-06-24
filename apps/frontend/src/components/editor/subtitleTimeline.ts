import { roundTimelineTime } from "@/components/editor/editorUtilities";
import type { SubtitleCue } from "@/lib/subtitles/types";

export interface SubtitleTimelineCue {
  id: string;
  sourceCueId?: string;
  sourceIndex: number;
  startTime: number;
  endTime: number;
  text: string;
  lines: string[];
}

export interface SubtitleTimelineTrack {
  id: string;
  trackKey: string;
  label: string;
  cues: SubtitleTimelineCue[];
}

export interface SubtitleTimelineLane {
  index: number;
  cues: SubtitleTimelineCue[];
}

export interface SubtitleCueTimingUpdate {
  cueId: string;
  startTime: number;
  endTime: number;
}

export type SubtitleCueTimingUpdateMode =
  | "move"
  | "resize-left"
  | "resize-right";

const subtitleActionPrefix = "subtitle-cue:";

export function subtitleTimelineActionId(cueId: string) {
  return `${subtitleActionPrefix}${cueId}`;
}

export function subtitleCueIdFromActionId(actionId: string) {
  return actionId.startsWith(subtitleActionPrefix)
    ? actionId.slice(subtitleActionPrefix.length)
    : null;
}

function isSubtitleTimelineActionId(actionId: string) {
  return subtitleCueIdFromActionId(actionId) !== null;
}

export function buildSubtitleTimelineTrack({
  trackKey,
  label,
  cues,
}: {
  trackKey: string;
  label: string;
  cues: readonly SubtitleCue[];
}): SubtitleTimelineTrack {
  return {
    id: `subtitle-track:${trackKey}`,
    trackKey,
    label,
    cues: cues.map((cue, index) => ({
      id: `${trackKey}:cue:${index}`,
      sourceCueId: cue.id,
      sourceIndex: index,
      startTime: cue.startTime,
      endTime: cue.endTime,
      text: cue.text,
      lines: [...cue.lines],
    })),
  };
}

export function subtitleTimelineTrackToCues(
  track: SubtitleTimelineTrack | null | undefined,
) {
  if (!track) {
    return [];
  }

  return sortSubtitleTimelineCues(track.cues).map<SubtitleCue>((cue) => ({
    id: cue.sourceCueId ?? cue.id,
    startTime: cue.startTime,
    endTime: cue.endTime,
    text: cue.text,
    lines: [...cue.lines],
  }));
}

function sortSubtitleTimelineCues(cues: readonly SubtitleTimelineCue[]) {
  return cues.toSorted((left, right) => {
    const startDelta = left.startTime - right.startTime;
    if (startDelta !== 0) {
      return startDelta;
    }

    const endDelta = left.endTime - right.endTime;
    if (endDelta !== 0) {
      return endDelta;
    }

    return left.id.localeCompare(right.id);
  });
}

export function assignSubtitleCueLanes(
  cues: readonly SubtitleTimelineCue[],
): SubtitleTimelineLane[] {
  const lanes: SubtitleTimelineLane[] = [];
  const laneEndTimes: number[] = [];

  for (const cue of sortSubtitleTimelineCues(cues)) {
    let laneIndex = laneEndTimes.findIndex(
      (endTime) => endTime <= cue.startTime,
    );
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push({ index: laneIndex, cues: [] });
      laneEndTimes.push(Number.NEGATIVE_INFINITY);
    }

    lanes[laneIndex]?.cues.push(cue);
    laneEndTimes[laneIndex] = cue.endTime;
  }

  return lanes;
}

export function subtitleCuesInTimelineWindow({
  cues,
  startTime,
  endTime,
}: {
  cues: readonly SubtitleTimelineCue[];
  startTime: number;
  endTime: number;
}) {
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    endTime <= startTime
  ) {
    return [];
  }

  return cues.filter(
    (cue) => cue.endTime >= startTime && cue.startTime <= endTime,
  );
}

export function isValidSubtitleCueRange({
  startTime,
  endTime,
  duration,
}: {
  startTime: number;
  endTime: number;
  duration: number;
}) {
  return (
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    Number.isFinite(duration) &&
    duration > 0 &&
    startTime >= 0 &&
    endTime <= duration &&
    endTime > startTime
  );
}

export function isValidSubtitleTimelineActionRange({
  actionId,
  startTime,
  endTime,
  duration,
}: {
  actionId: string;
  startTime: number;
  endTime: number;
  duration: number;
}) {
  return (
    isSubtitleTimelineActionId(actionId) &&
    isValidSubtitleCueRange({ startTime, endTime, duration })
  );
}

export function roundSubtitleCueTimingUpdate(
  update: SubtitleCueTimingUpdate,
): SubtitleCueTimingUpdate {
  return {
    cueId: update.cueId,
    startTime: roundTimelineTime(update.startTime),
    endTime: roundTimelineTime(update.endTime),
  };
}

export function snapSubtitleCueTimingUpdateToAdjacentCue({
  track,
  update,
  duration,
  thresholdSeconds,
  mode,
}: {
  track: SubtitleTimelineTrack | null | undefined;
  update: SubtitleCueTimingUpdate;
  duration: number;
  thresholdSeconds: number;
  mode: SubtitleCueTimingUpdateMode;
}): SubtitleCueTimingUpdate {
  const roundedUpdate = roundSubtitleCueTimingUpdate(update);
  if (
    !track ||
    !Number.isFinite(thresholdSeconds) ||
    thresholdSeconds <= 0 ||
    !isValidSubtitleCueRange({
      startTime: roundedUpdate.startTime,
      endTime: roundedUpdate.endTime,
      duration,
    })
  ) {
    return roundedUpdate;
  }

  const cueDuration = roundTimelineTime(
    roundedUpdate.endTime - roundedUpdate.startTime,
  );
  const snapCandidates: Array<{
    distance: number;
    update: SubtitleCueTimingUpdate;
  }> = [];

  const considerSnap = (
    distance: number,
    snappedUpdate: SubtitleCueTimingUpdate,
  ) => {
    if (
      distance > thresholdSeconds ||
      !isValidSubtitleCueRange({
        startTime: snappedUpdate.startTime,
        endTime: snappedUpdate.endTime,
        duration,
      })
    ) {
      return;
    }

    snapCandidates.push({ distance, update: snappedUpdate });
  };

  for (const cue of track.cues) {
    if (cue.id === roundedUpdate.cueId) {
      continue;
    }

    const cueStart = roundTimelineTime(cue.startTime);
    const cueEnd = roundTimelineTime(cue.endTime);

    if (mode === "move" || mode === "resize-left") {
      const snappedStart = cueEnd;
      considerSnap(Math.abs(roundedUpdate.startTime - snappedStart), {
        cueId: roundedUpdate.cueId,
        startTime: snappedStart,
        endTime:
          mode === "move"
            ? roundTimelineTime(snappedStart + cueDuration)
            : roundedUpdate.endTime,
      });
    }

    if (mode === "move" || mode === "resize-right") {
      const snappedEnd = cueStart;
      considerSnap(Math.abs(roundedUpdate.endTime - snappedEnd), {
        cueId: roundedUpdate.cueId,
        startTime:
          mode === "move"
            ? roundTimelineTime(snappedEnd - cueDuration)
            : roundedUpdate.startTime,
        endTime: snappedEnd,
      });
    }
  }

  const bestSnap = snapCandidates.toSorted(
    (left, right) => left.distance - right.distance,
  )[0];

  return bestSnap
    ? roundSubtitleCueTimingUpdate(bestSnap.update)
    : roundedUpdate;
}

export function applySubtitleCueTimingUpdates({
  track,
  updates,
  duration,
}: {
  track: SubtitleTimelineTrack | null;
  updates: readonly SubtitleCueTimingUpdate[];
  duration: number;
}) {
  if (!track || updates.length === 0) {
    return track;
  }

  const validUpdates = new Map(
    updates
      .filter((update) =>
        isValidSubtitleCueRange({
          startTime: update.startTime,
          endTime: update.endTime,
          duration,
        }),
      )
      .map((update) => [update.cueId, update]),
  );

  if (validUpdates.size === 0) {
    return track;
  }

  let changed = false;
  const cues = track.cues.map((cue) => {
    const update = validUpdates.get(cue.id);
    if (
      !update ||
      (cue.startTime === update.startTime && cue.endTime === update.endTime)
    ) {
      return cue;
    }

    changed = true;
    return {
      ...cue,
      startTime: update.startTime,
      endTime: update.endTime,
    };
  });

  return changed ? { ...track, cues } : track;
}

export function subtitleCueTimelineLabel(
  cue: Pick<SubtitleTimelineCue, "text">,
) {
  const label = cue.text.replaceAll(/\s+/g, " ").trim();
  return label || "Subtitle";
}
