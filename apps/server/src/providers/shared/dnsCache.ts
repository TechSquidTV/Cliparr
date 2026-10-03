import { isIP } from "node:net";
import { lookupWithSignal } from "@/providers/shared/dnsLookup";
import {
  normalizeHostname,
  normalizeIpCandidate,
} from "@/providers/shared/networkPolicy";
import { uniqueStrings } from "@/providers/shared/utilities";

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
