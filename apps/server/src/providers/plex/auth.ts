import {
  requestPin,
  requestPinStatus,
  requestResources,
} from "@/providers/plex/cloudClient";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createApiError } from "@/http/errors";
import {
  AUTH_TTL_MS,
  MAX_PENDING_AUTH_REQUESTS,
  normalizeResources,
  PLEX_CLIENT_IDENTIFIER,
  PLEX_PRODUCT,
  requirePlexServerResources,
  type PlexAuthRequest,
} from "@/providers/plex/shared";

const authRequests = new Map<string, PlexAuthRequest>();
const AUTH_POLL_TOKEN_BYTES = 32;

function createAuthPollToken() {
  return randomBytes(AUTH_POLL_TOKEN_BYTES).toString("base64url");
}

function hashAuthPollToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function authPollTokenMatches(expectedHash: string, token: string) {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(hashAuthPollToken(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function pruneExpiredAuthRequests(now = Date.now()) {
  for (const [authId, authRequest] of authRequests.entries()) {
    if (authRequest.expiresAt <= now) {
      authRequests.delete(authId);
    }
  }
}

export async function startAuth(callbackUrl: string) {
  pruneExpiredAuthRequests();
  if (authRequests.size >= MAX_PENDING_AUTH_REQUESTS) {
    throw createApiError(
      503,
      "plex_auth_busy",
      "Too many pending Plex sign-ins. Wait a moment and try again.",
    );
  }

  const data = await requestPin();

  if (!data.id || !data.code) {
    throw createApiError(
      502,
      "plex_auth_start_failed",
      "Plex did not return a PIN",
    );
  }

  const authId = randomUUID();
  const pollToken = createAuthPollToken();
  const expiresAt =
    Date.now() + (data.expiresIn ? data.expiresIn * 1000 : AUTH_TTL_MS);
  authRequests.set(authId, {
    authId,
    pinId: data.id,
    code: data.code,
    pollTokenHash: hashAuthPollToken(pollToken),
    expiresAt,
  });

  const authUrl = new URL("https://app.plex.tv/auth");
  authUrl.hash = `?${new URLSearchParams({
    clientID: PLEX_CLIENT_IDENTIFIER,
    code: data.code,
    forwardUrl: callbackUrl,
    "context[device][product]": PLEX_PRODUCT,
  }).toString()}`;

  return {
    authId,
    authUrl: authUrl.toString(),
    expiresAt: new Date(expiresAt).toISOString(),
    pollToken,
  };
}

export async function pollAuth(authId: string, pollToken: string) {
  pruneExpiredAuthRequests();
  const authRequest = authRequests.get(authId);
  if (!authRequest) {
    return { status: "expired" as const };
  }

  if (authRequest.expiresAt <= Date.now()) {
    authRequests.delete(authId);
    return { status: "expired" as const };
  }

  if (!authPollTokenMatches(authRequest.pollTokenHash, pollToken)) {
    throw createApiError(
      401,
      "invalid_plex_auth_session",
      "Plex sign-in must be completed from the browser that started it",
    );
  }

  const data = await requestPinStatus(authRequest.pinId, authRequest.code);
  const userToken = data.authToken;

  if (!userToken) {
    return { status: "pending" as const };
  }

  const resources = requirePlexServerResources(
    normalizeResources(await requestResources(userToken)),
  );
  authRequests.delete(authId);

  return {
    status: "complete" as const,
    userToken,
    resources,
  };
}
