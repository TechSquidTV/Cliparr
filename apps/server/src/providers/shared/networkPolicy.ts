const DISALLOWED_REMOTE_HOSTNAMES = new Set([
  "metadata",
  "metadata.azure.internal",
  "metadata.google.internal",
]);

export function normalizeIpCandidate(value: string) {
  const normalized = value.toLowerCase();
  const unwrapped =
    normalized.startsWith("[") && normalized.endsWith("]")
      ? normalized.slice(1, -1)
      : normalized;

  const mappedIpv4Prefix = "::ffff:";
  if (!unwrapped.startsWith(mappedIpv4Prefix)) {
    return unwrapped;
  }

  return (
    mappedIpv4Address(unwrapped.slice(mappedIpv4Prefix.length)) ?? unwrapped
  );
}

export function normalizeHostname(value: string) {
  return normalizeIpCandidate(value.trim()).replace(/\.+$/, "");
}

function ipv4Octets(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return;
  }

  const octets = parts.map(Number);
  if (
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return;
  }

  return octets as [number, number, number, number];
}

function mappedIpv4Address(hostname: string) {
  const octets = ipv4Octets(hostname);
  if (octets) {
    return octets.join(".");
  }

  const words = hostname.split(":");
  if (words.length !== 2) {
    return;
  }

  const ipv6WordMax = 65_535;
  const byteMask = 255;
  const parsedWords = words.map((word) => Number.parseInt(word, 16));
  if (
    words.some(
      (word, index) =>
        !/^[\da-f]{1,4}$/i.test(word) ||
        !Number.isInteger(parsedWords[index]) ||
        parsedWords[index] < 0 ||
        parsedWords[index] > ipv6WordMax,
    )
  ) {
    return;
  }

  const [high, low] = parsedWords as [number, number];
  return [high >> 8, high & byteMask, low >> 8, low & byteMask].join(".");
}

function isUnsafeIpv4Host(hostname: string, allowPrivate: boolean) {
  const octets = ipv4Octets(hostname);
  if (!octets) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    first >= 224 ||
    (!allowPrivate &&
      (first === 10 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)))
  );
}

function isUnsafeIpv6Host(hostname: string, allowPrivate: boolean) {
  return (
    hostname === "::" ||
    hostname === "::1" ||
    hostname === "0:0:0:0:0:0:0:1" ||
    (!allowPrivate && /^f[cd][\da-f]{2}:/i.test(hostname)) ||
    /^fe[89ab][\da-f]:/i.test(hostname) ||
    /^ff[\da-f]{2}:/i.test(hostname)
  );
}

export function isUnsafeRemoteHostname(
  hostname: string,
  options: { allowPrivate?: boolean } = {},
) {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    DISALLOWED_REMOTE_HOSTNAMES.has(normalized) ||
    isUnsafeIpv4Host(normalized, options.allowPrivate === true) ||
    isUnsafeIpv6Host(normalized, options.allowPrivate === true)
  );
}

export function isRedirectStatus(status: number) {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

export function removeSensitiveRedirectHeaders(init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("x-plex-token");
  return {
    ...init,
    headers,
  };
}
