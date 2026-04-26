export const DEFAULT_SERVER_PORT = 3000;

function defaultPublicAppUrl() {
  return `http://localhost:${getServerPort()}`;
}

function normalizedHostname(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost"
    || hostname === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export function getPublicAppUrl() {
  return new URL(process.env.APP_URL ?? defaultPublicAppUrl());
}

export function getServerPort() {
  const parsedPort = Number.parseInt(process.env.PORT ?? "", 10);
  return Number.isInteger(parsedPort) && parsedPort > 0
    ? parsedPort
    : DEFAULT_SERVER_PORT;
}

export function publicAppUsesSecureTransport() {
  return getPublicAppUrl().protocol === "https:";
}

export function publicAppOriginIsPotentiallyTrustworthy() {
  const appUrl = getPublicAppUrl();

  return appUrl.protocol === "https:"
    || isLoopbackHostname(normalizedHostname(appUrl.hostname));
}
