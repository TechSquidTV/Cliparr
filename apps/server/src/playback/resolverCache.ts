import type {
  PlaybackResolver,
  CurrentlyPlayingEntry,
} from "@/providers/types";
import type { ProviderSessionRecord } from "@/session/store";

/** Share provider metadata, while keeping handles and playback setup session-owned. */
export function createPlaybackResolverCache<Row, Prepared>(options: {
  key: (row: Row) => string;
  prepare: (row: Row) => Promise<Prepared>;
  bind: (
    row: Row,
    prepared: Prepared,
    session: ProviderSessionRecord,
  ) => Promise<CurrentlyPlayingEntry | undefined>;
  update: (entry: CurrentlyPlayingEntry, row: Row) => CurrentlyPlayingEntry;
}) {
  const entries = new Map<
    string,
    (
      session: ProviderSessionRecord,
    ) => Promise<CurrentlyPlayingEntry | undefined>
  >();
  return (rows: Row[]): PlaybackResolver => {
    const currentKeys = new Set(rows.map((row) => options.key(row)));
    for (const key of entries.keys()) {
      if (!currentKeys.has(key)) {
        entries.delete(key);
      }
    }
    const resolvers = rows.map((row) => {
      const key = options.key(row);
      let resolve = entries.get(key);
      if (!resolve) {
        let prepared: Promise<Prepared> | undefined;
        const bound = new WeakMap<
          ProviderSessionRecord,
          Promise<CurrentlyPlayingEntry | undefined>
        >();
        resolve = (session) => {
          let result = bound.get(session);
          if (!result) {
            prepared ??= options.prepare(row).catch((error: unknown) => {
              prepared = undefined;
              throw error;
            });
            result = prepared
              .then((value) => options.bind(row, value, session))
              .catch((error: unknown) => {
                bound.delete(session);
                throw error;
              });
            bound.set(session, result);
          }
          return result;
        };
        entries.set(key, resolve);
      }
      return async (session: ProviderSessionRecord) => {
        const entry = await resolve(session);
        return entry ? options.update(entry, row) : undefined;
      };
    });
    return async (session) => {
      const results = await Promise.all(
        resolvers.map((resolve) => resolve(session)),
      );
      return results.filter(
        (entry): entry is CurrentlyPlayingEntry => entry !== undefined,
      );
    };
  };
}
