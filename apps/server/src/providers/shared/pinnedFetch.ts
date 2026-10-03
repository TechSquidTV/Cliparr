import { isIP, type Socket, type LookupFunction } from "node:net";
import { Agent, buildConnector } from "undici";

const PINNED_DNS_IDLE_TIMEOUT_MS = 60_000;
const PINNED_DNS_POOL_MAX_SIZE = 32;
const pinnedDnsAgents = new Map<string, { agent: Agent; lastUsed: number }>();

function getPooledPinnedDnsAgent(addresses: readonly string[]): Agent {
  const now = Date.now();
  for (const [key, entry] of pinnedDnsAgents) {
    if (now - entry.lastUsed > PINNED_DNS_IDLE_TIMEOUT_MS) {
      pinnedDnsAgents.delete(key);
      // Graceful close lets in-flight response bodies finish or be cancelled.
      void entry.agent.close().catch(() => {});
    }
  }

  // Agents pool by origin internally, preserving each URL's Host and TLS SNI.
  const key = JSON.stringify(addresses.toSorted());
  const entry = pinnedDnsAgents.get(key) ?? {
    agent: createPinnedDnsAgent(addresses, {
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 120_000,
    }),
    lastUsed: now,
  };
  entry.lastUsed = now;
  // Map insertion order tracks recency, including hits within the same millisecond.
  pinnedDnsAgents.delete(key);
  pinnedDnsAgents.set(key, entry);

  if (pinnedDnsAgents.size > PINNED_DNS_POOL_MAX_SIZE) {
    const oldest = pinnedDnsAgents.entries().next().value;
    if (oldest) {
      pinnedDnsAgents.delete(oldest[0]);
      void oldest[1].agent.close().catch(() => {});
    }
  }
  return entry.agent;
}

export async function closePooledPinnedDnsAgents(): Promise<void> {
  const agents = [...pinnedDnsAgents.values()];
  pinnedDnsAgents.clear();
  await Promise.all(agents.map(({ agent }) => agent.close()));
}

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

  const dispatcher = getPooledPinnedDnsAgent(addresses);
  const requestInit = { ...init, dispatcher };
  return globalThis.fetch(url.toString(), requestInit);
}

export function createPinnedDnsAgent(
  addresses: readonly string[],
  options: {
    onSocket?: (socket: Socket) => void;
    webSocket?: Agent.Options["webSocket"];
    keepAliveTimeout?: Agent.Options["keepAliveTimeout"];
    keepAliveMaxTimeout?: Agent.Options["keepAliveMaxTimeout"];
  } = {},
) {
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
  const connect = buildConnector({ lookup });
  return new Agent({
    webSocket: options.webSocket,
    keepAliveTimeout: options.keepAliveTimeout,
    keepAliveMaxTimeout: options.keepAliveMaxTimeout,
    connect(connection, callback) {
      connect(connection, (error, socket) => {
        if (error) {
          callback(error, null);
        } else {
          options.onSocket?.(socket);
          callback(null, socket);
        }
      });
    },
  });
}
