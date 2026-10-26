import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { addAbortListener } from "node:events";
import { isIP } from "node:net";

import { dedupeInflightFetch } from "@/providers/shared/inflight";
import {
  normalizeHostname,
  normalizeIpCandidate,
} from "@/providers/shared/networkPolicy";
import { errorMessage, uniqueStrings } from "@/providers/shared/utilities";

const DNS_VALIDATION_CACHE_TTL_MS = 60_000;
const resolvedHostnameCache = new Map<
  string,
  { expiresAt: number; addresses: string[] }
>();

/** Cache successful DNS results; lookupWithSignal shares OS work with independent cancellation. */
export async function resolveHostnameAddresses(
  hostname: string,
  signal: AbortSignal,
): Promise<string[]> {
  signal.throwIfAborted();
  const normalized = normalizeHostname(hostname);
  if (isIP(normalized)) {
    return [];
  }
  const now = Date.now();
  const cached = resolvedHostnameCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return [...cached.addresses];
  }
  // Bound retained entries to live TTLs, including hosts never requested again.
  for (const [key, entry] of resolvedHostnameCache) {
    if (entry.expiresAt <= now) {
      resolvedHostnameCache.delete(key);
    }
  }
  const records = await lookupWithSignal(normalized, signal);
  signal.throwIfAborted();
  const addresses = uniqueStrings(
    records.map((record) => normalizeIpCandidate(record.address)),
  );
  resolvedHostnameCache.set(normalized, {
    addresses,
    expiresAt: Date.now() + DNS_VALIDATION_CACHE_TTL_MS,
  });
  return [...addresses];
}

const inflightLookups = new Map<string, Promise<LookupAddress[]>>();

async function lookupWithSignal(hostname: string, signal: AbortSignal) {
  signal.throwIfAborted();
  let subscription: ReturnType<typeof addAbortListener> | undefined;
  try {
    const cancellation = new Promise<never>((_resolve, reject) => {
      subscription = addAbortListener(signal, () => {
        const reason: unknown = signal.reason;
        reject(
          reason instanceof Error ? reason : new Error(errorMessage(reason)),
        );
      });
    });
    // lookup() cannot cancel its OS work; stop waiting when the request aborts.
    return await Promise.race([
      dedupeInflightFetch(inflightLookups, hostname, () =>
        lookup(hostname, { all: true, order: "verbatim" }),
      ),
      cancellation,
    ]);
  } finally {
    subscription?.[Symbol.dispose]();
  }
}
