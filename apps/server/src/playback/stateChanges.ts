type StateChange = { type: "sources" } | { type: "session"; sessionId: string };
const listeners = new Set<(change: StateChange) => void>();

export function notifyPlaybackStateChange(change: StateChange) {
  // Repository mutations can happen during discovery. Reconcile after the write.
  queueMicrotask(() => {
    for (const listener of listeners) {
      listener(change);
    }
  });
}

export function subscribePlaybackStateChanges(
  listener: (change: StateChange) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
