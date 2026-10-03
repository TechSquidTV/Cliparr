// Share one in-flight promise across concurrent callers keyed by `key`.
// Entries are removed as soon as they settle, so a rejection is retried on
// the next call instead of being cached.
export function dedupeInflightFetch<T>(
  inflight: Map<string, Promise<T>>,
  key: string,
  fetch: () => Promise<T>,
): Promise<T> {
  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }
  const pending = fetch();
  inflight.set(key, pending);
  const cleanup = () => {
    if (inflight.get(key) === pending) {
      inflight.delete(key);
    }
  };
  void pending.then(cleanup, cleanup);
  return pending;
}
