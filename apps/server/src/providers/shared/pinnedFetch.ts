import { isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";

/** Keep the URL hostname for HTTP Host/TLS while connecting only to validated IPs. */
export async function fetchWithPinnedDns(
  url: URL,
  init: RequestInit,
  addresses: readonly string[] | undefined,
) {
  if (
    addresses === undefined ||
    isIP(url.hostname.replaceAll(/^\[|\]$/g, ""))
  ) {
    return globalThis.fetch(url.toString(), init);
  }

  const records = addresses.map((address) => ({
    address,
    family: isIP(address),
  }));
  if (records.length === 0 || records.some((record) => record.family === 0)) {
    throw new Error("No validated IP addresses are available for this request");
  }

  const lookup: LookupFunction = (_hostname, options, callback) => {
    const candidates = records.filter(
      (record) => !options.family || options.family === record.family,
    );
    const first = candidates[0];
    if (!first) {
      callback(
        new Error("No validated address matches the requested family"),
        "",
        0,
      );
    } else if (options.all) {
      callback(null, candidates);
    } else {
      callback(null, first.address, first.family);
    }
  };
  const dispatcher = new Agent({ connect: { lookup } });
  const requestInit = { ...init, dispatcher };
  try {
    return await globalThis.fetch(url.toString(), requestInit);
  } finally {
    // Graceful close waits for the response body to finish or be cancelled.
    void dispatcher.close().catch(() => {});
  }
}
