import type { MediaSource } from "../../db/mediaSourcesRepository.js";
import { ApiError } from "../../http/errors.js";
import type { ProviderResource } from "../types.js";
import { stringValue } from "../shared/utils.js";
import {
  connectionInfo,
  fetchCurrentUser,
  fetchSessions,
  JELLYFIN_DEVICE_ID,
  JELLYFIN_REQUEST_TIMEOUT_MS,
  jellyfinJson,
  jellyfinSourceName,
  normalizeBaseUrl,
  resolveCredentialServerUrl,
  sourceContext,
} from "./shared.js";

async function parseCredentialsInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(
      400,
      "invalid_jellyfin_credentials",
      "Provide a JSON object with Jellyfin serverUrl, username, and password"
    );
  }

  const record = body as Record<string, unknown>;
  const serverUrl = stringValue(record.serverUrl);
  const username = stringValue(record.username);

  if (!serverUrl) {
    throw new ApiError(400, "invalid_jellyfin_server_url", "Jellyfin serverUrl must be a non-empty string");
  }

  if (!username) {
    throw new ApiError(400, "invalid_jellyfin_username", "Jellyfin username must be a non-empty string");
  }

  if (typeof record.password !== "string") {
    throw new ApiError(400, "invalid_jellyfin_password", "Jellyfin password must be a string");
  }

  return {
    serverUrl: await resolveCredentialServerUrl(serverUrl),
    username,
    password: record.password,
  };
}

export async function authenticateWithCredentials(body: unknown) {
  const { serverUrl, username, password } = await parseCredentialsInput(body);
  const publicInfo = await jellyfinJson<any>(serverUrl, "/System/Info/Public", {
    deviceId: JELLYFIN_DEVICE_ID,
    timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
    errorCode: "jellyfin_server_unreachable",
    failureMessage: "Could not reach that Jellyfin server",
    exposeFailureDetail: false,
  });

  let authResult: any;
  try {
    authResult = await jellyfinJson<any>(serverUrl, "/Users/AuthenticateByName", {
      deviceId: JELLYFIN_DEVICE_ID,
      timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
      method: "POST",
      body: JSON.stringify({
        Username: username,
        Pw: password,
      }),
      errorCode: "jellyfin_auth_failed",
      failureMessage: "Jellyfin sign-in failed",
      exposeFailureDetail: false,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw new ApiError(401, "invalid_jellyfin_credentials", "Incorrect Jellyfin username or password");
    }

    throw err;
  }

  const accessToken = stringValue(authResult?.AccessToken);
  const user = authResult?.User;
  const userId = stringValue(user?.Id);
  const isAdministrator = user?.Policy?.IsAdministrator === true;
  const serverId = stringValue(authResult?.ServerId) ?? stringValue(publicInfo?.Id);

  if (!accessToken || !userId || !serverId) {
    throw new ApiError(
      502,
      "jellyfin_auth_failed",
      "Jellyfin did not return the server or user details Cliparr needs"
    );
  }

  if (!isAdministrator) {
    throw new ApiError(
      403,
      "jellyfin_admin_required",
      "Cliparr needs a Jellyfin administrator account so it can view active sessions across the server"
    );
  }

  const normalizedBaseUrl = normalizeBaseUrl(serverUrl);

  return {
    userToken: accessToken,
    resources: [{
      id: serverId,
      name: jellyfinSourceName(publicInfo?.ServerName, normalizedBaseUrl),
      product: stringValue(publicInfo?.ProductName) ?? "Jellyfin",
      platform: stringValue(publicInfo?.Version),
      provides: ["server"],
      owned: true,
      accessToken,
      connections: [connectionInfo(normalizedBaseUrl)],
      credentials: {
        userId,
        deviceId: JELLYFIN_DEVICE_ID,
      },
      metadata: {
        serverId,
        serverName: stringValue(publicInfo?.ServerName),
        version: stringValue(publicInfo?.Version),
        username: stringValue(user?.Name) ?? username,
        userId,
        isAdministrator: true,
      },
    } satisfies ProviderResource],
  };
}

export async function checkSource(source: MediaSource) {
  try {
    const context = sourceContext(source);
    const [publicInfo, currentUser] = await Promise.all([
      jellyfinJson<any>(context.baseUrl, "/System/Info/Public", {
        deviceId: context.deviceId,
        timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
        errorCode: "jellyfin_server_unreachable",
        failureMessage: "Could not reach that Jellyfin server",
      }),
      fetchCurrentUser(context),
    ]);

    if (currentUser?.Policy?.IsAdministrator !== true) {
      return {
        ok: false as const,
        message: "Cliparr needs a Jellyfin administrator account to read active sessions",
      };
    }

    await fetchSessions(context);

    return {
      ok: true as const,
      name: jellyfinSourceName(publicInfo?.ServerName, context.baseUrl),
      baseUrl: normalizeBaseUrl(context.baseUrl),
      metadata: {
        ...source.metadata,
        product: stringValue(publicInfo?.ProductName) ?? stringValue(source.metadata.product),
        platform: stringValue(publicInfo?.Version) ?? stringValue(source.metadata.platform),
        serverId: stringValue(publicInfo?.Id) ?? stringValue(source.metadata.serverId),
        serverName: stringValue(publicInfo?.ServerName) ?? stringValue(source.metadata.serverName),
        version: stringValue(publicInfo?.Version) ?? stringValue(source.metadata.version),
        username: stringValue(currentUser?.Name) ?? stringValue(source.metadata.username),
        userId: stringValue(currentUser?.Id) ?? stringValue(source.metadata.userId),
        isAdministrator: true,
      },
    };
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        ok: false as const,
        message: err.message,
      };
    }

    throw err;
  }
}
