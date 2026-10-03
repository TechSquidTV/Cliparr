import type {
  PlaybackResolver,
  CurrentlyPlayingEntry,
} from "@/providers/types";
import type { ProviderSessionRecord } from "@/session/store";

/** Share provider metadata, while keeping handles and playback setup session-owned. */
export function createPlaybackResolverCache<Row, Prepared>(options: {
  key: (row: Row) => string;
  // Results must align with the input rows. Failed batches retry as batches.
  prepareMany: (rows: Row[]) => Promise<Prepared[]>;
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
    const keyedRows = rows.map((row) => ({ row, key: options.key(row) }));
    const currentKeys = new Set(keyedRows.map(({ key }) => key));
    for (const key of entries.keys()) {
      if (!currentKeys.has(key)) {
        entries.delete(key);
      }
    }
    const missing = new Map<string, Row>();
    for (const { key, row } of keyedRows) {
      if (!entries.has(key) && !missing.has(key)) {
        missing.set(key, row);
      }
    }
    const missingRows = [...missing.values()];
    let batch: Promise<Prepared[]> | undefined;
    const prepareBatch = () => {
      // Start lazily when bound, so unused resolvers do no work and cannot
      // produce an unhandled rejection. All new keys share this promise.
      batch ??= Promise.resolve()
        .then(() => options.prepareMany(missingRows))
        .then((values) => {
          if (values.length !== missingRows.length) {
            throw new Error(
              "Batched playback preparation returned an invalid result count",
            );
          }
          return values;
        })
        .catch((error: unknown) => {
          batch = undefined;
          throw error;
        });
      return batch;
    };
    for (const [index, [key, row]] of [...missing].entries()) {
      let prepared: Promise<Prepared> | undefined;
      const bound = new WeakMap<
        ProviderSessionRecord,
        Promise<CurrentlyPlayingEntry | undefined>
      >();
      entries.set(key, (session) => {
        let result = bound.get(session);
        if (!result) {
          prepared ??= prepareBatch()
            .then((values) => values[index]!)
            .catch((error: unknown) => {
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
      });
    }
    const resolvers = keyedRows.map(({ row, key }) => {
      const resolve = entries.get(key)!;
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
