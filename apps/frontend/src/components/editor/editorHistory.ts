import {
  toSeconds,
  type TimelineEngine,
  type TimelineStateSnapshot,
} from "@techsquidtv/canvas-timeline";

type ClipRange = Pick<TimelineStateSnapshot, "inPoint" | "outPoint">;
type RangeEdit = { kind: "range"; before: ClipRange; after: ClipRange };
type Edit = RangeEdit | { kind: "timeline"; steps: number };

function readRange(engine: TimelineEngine): ClipRange {
  const { inPoint, outPoint } = engine.getState();
  return { inPoint, outPoint };
}

function rangesEqual(left: ClipRange, right: ClipRange) {
  return ["inPoint", "outPoint"].every((key) => {
    const boundary = key as keyof ClipRange;
    const a = left[boundary];
    const b = right[boundary];
    return a && b ? toSeconds(a) === toSeconds(b) : a === b;
  });
}

// Canvas Timeline owns document history. Its history excludes In/Out, so this
// adapter orders range edits alongside native undo/redo without copying tracks.
export function createEditorHistory(engine: TimelineEngine) {
  engine.snapshot();
  const past: Edit[] = [];
  const future: Edit[] = [];
  const listeners = new Set<() => void>();
  let range = readRange(engine);
  let replaying = false;
  let rangeGesture = false;
  let actionDepth = 0;
  let actionSteps = 0;
  let availableUndoSteps = 0;
  let groupedRange: RangeEdit | null = null;
  let snapshot = { canUndo: false, canRedo: false };

  const notify = () => {
    const previous = past.at(-1);
    const next = future.at(-1);
    snapshot = {
      canUndo: Boolean(
        previous && (previous.kind === "range" || engine.canUndo),
      ),
      canRedo: Boolean(next && (next.kind === "range" || engine.canRedo)),
    };
    for (const listener of listeners) {
      listener();
    }
  };
  const push = (edit: Edit) => {
    past.push(edit);
    if (past.length > 75) {
      past.shift();
    }
    // Native history also has a byte budget. Drop whole editor actions when
    // their oldest native snapshots have been evicted, never half an import.
    let retainedSteps = past.reduce(
      (count, item) => count + (item.kind === "timeline" ? item.steps : 0),
      0,
    );
    while (retainedSteps > availableUndoSteps) {
      const removed = past.shift();
      if (removed?.kind === "timeline") {
        retainedSteps -= removed.steps;
      }
    }
    future.length = 0;
    notify();
  };
  const unsubscribeRange = engine.on("state:inOut", () => {
    const next = readRange(engine);
    if (!replaying && !rangesEqual(range, next)) {
      if (groupedRange && past.at(-1) === groupedRange) {
        groupedRange.after = next;
        notify();
      } else {
        groupedRange = { kind: "range", before: range, after: next };
        push(groupedRange);
      }
      if (!rangeGesture) {
        queueMicrotask(() => {
          groupedRange = null;
        });
      }
    }
    range = next;
  });
  const unsubscribeTimeline = engine.on("history:change", ({ index }) => {
    availableUndoSteps = index;
    if (!replaying) {
      groupedRange = null;
      if (actionDepth > 0) {
        actionSteps += 1;
      } else {
        push({ kind: "timeline", steps: 1 });
      }
    }
  });

  function restoreRange(next: ClipRange) {
    if (next.inPoint && next.outPoint) {
      engine.setInOutRange(next.inPoint, next.outPoint);
    } else {
      engine.clearInOutPoints();
      if (next.inPoint) {
        engine.setInPoint(next.inPoint);
      }
      if (next.outPoint) {
        engine.setOutPoint(next.outPoint);
      }
    }
  }
  function move(direction: "undo" | "redo") {
    if (!(direction === "undo" ? snapshot.canUndo : snapshot.canRedo)) {
      return;
    }
    const source = direction === "undo" ? past : future;
    const destination = direction === "undo" ? future : past;
    const edit = source.pop();
    if (!edit) {
      return;
    }
    groupedRange = null;
    replaying = true;
    try {
      if (edit.kind === "range") {
        restoreRange(direction === "undo" ? edit.before : edit.after);
      } else {
        for (let step = 0; step < edit.steps; step += 1) {
          if (direction === "undo") {
            engine.undo();
          } else {
            engine.redo();
          }
        }
      }
      destination.push(edit);
    } finally {
      replaying = false;
      range = readRange(engine);
      notify();
    }
  }
  return {
    runAction: (action: () => void) => {
      actionDepth += 1;
      try {
        action();
      } finally {
        actionDepth -= 1;
        if (actionDepth === 0 && actionSteps > 0) {
          const steps = actionSteps;
          actionSteps = 0;
          push({ kind: "timeline", steps });
        }
      }
    },
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    undo: () => move("undo"),
    redo: () => move("redo"),
    beginRangeGesture: () => {
      rangeGesture = true;
      groupedRange = null;
    },
    endRangeGesture: () => {
      rangeGesture = false;
      groupedRange = null;
    },
    dispose: () => {
      unsubscribeRange();
      unsubscribeTimeline();
      listeners.clear();
    },
  };
}
