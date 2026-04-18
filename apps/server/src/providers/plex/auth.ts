import { randomUUID } from "crypto";
import { ApiError } from "../../http/errors.js";
import {
  AUTH_TTL_MS,
  getPlexAuthCompleteUrl,
  MAX_PENDING_AUTH_REQUESTS,
  normalizeResources,
  PLEX_CLIENT_IDENTIFIER,
  plexFetch,
  PLEX_PRODUCT,
  type PlexAuthRequest,
  type PlexResourceResponse,
} from "./shared.js";

const authRequests = new Map<string, PlexAuthRequest>();

function pruneExpiredAuthRequests(now = Date.now()) {
  for (const [authId, authRequest] of authRequests.entries()) {
    if (authRequest.expiresAt <= now) {
      authRequests.delete(authId);
    }
  }
}

export async function startAuth() {
  pruneExpiredAuthRequests();
  if (authRequests.size >= MAX_PENDING_AUTH_REQUESTS) {
    throw new ApiError(503, "plex_auth_busy", "Too many pending Plex sign-ins. Wait a moment and try again.");
  }

  const response = await plexFetch("https://plex.tv/api/v2/pins?strong=true", {
    method: "POST",
  });
  const data = (await response.json()) as { id: number; code: string; expiresIn?: number };

  if (!data.id || !data.code) {
    throw new ApiError(502, "plex_auth_start_failed", "Plex did not return a PIN");
  }

  const authId = randomUUID();
  const expiresAt = Date.now() + (data.expiresIn ? data.expiresIn * 1000 : AUTH_TTL_MS);
  authRequests.set(authId, {
    authId,
    pinId: data.id,
    code: data.code,
    expiresAt,
  });

  const authUrl = new URL("https://app.plex.tv/auth");
  authUrl.hash = `?${new URLSearchParams({
    clientID: PLEX_CLIENT_IDENTIFIER,
    code: data.code,
    forwardUrl: getPlexAuthCompleteUrl(),
    "context[device][product]": PLEX_PRODUCT,
  }).toString()}`;

  return {
    authId,
    authUrl: authUrl.toString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export async function pollAuth(authId: string) {
  pruneExpiredAuthRequests();
  const authRequest = authRequests.get(authId);
  if (!authRequest) {
    return { status: "expired" as const };
  }

  if (authRequest.expiresAt <= Date.now()) {
    authRequests.delete(authId);
    return { status: "expired" as const };
  }

  const response = await plexFetch(`https://plex.tv/api/v2/pins/${authRequest.pinId}`);
  const data = (await response.json()) as { authToken?: string; auth_token?: string };
  const userToken = data.authToken ?? data.auth_token;

  if (!userToken) {
    return { status: "pending" as const };
  }

  const resourcesResponse = await plexFetch(
    "https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1",
    {
      headers: {
        "X-Plex-Token": userToken,
      },
    }
  );
  const resources = normalizeResources((await resourcesResponse.json()) as PlexResourceResponse[]);
  authRequests.delete(authId);

  return {
    status: "complete" as const,
    userToken,
    resources,
  };
}
