const DEFAULT_APP_URL = "http://localhost:3000";

function normalizedHostname(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost"
    || hostname === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export function getPublicAppUrl() {
  return new URL(process.env.APP_URL ?? DEFAULT_APP_URL);
}

export function publicAppUsesSecureTransport() {
  return getPublicAppUrl().protocol === "https:";
}

export function publicAppOriginIsPotentiallyTrustworthy() {
  const appUrl = getPublicAppUrl();

  return appUrl.protocol === "https:"
    || isLoopbackHostname(normalizedHostname(appUrl.hostname));
}
