import type { MediaSource } from "@/db/mediaSourcesRepository";
import { createApiError, isApiError } from "@/http/errors";
import type { ProviderResource } from "@/providers/types";
import { stringValue } from "@/providers/shared/utils";
import {
  authenticateJellyfinUser,
  connectionInfo,
  fetchCurrentUser,
  fetchPublicSystemInfo,
  fetchSessions,
  JELLYFIN_DEVICE_ID,
  JELLYFIN_REQUEST_TIMEOUT_MS,
  jellyfinSourceName,
  normalizeBaseUrl,
  resolveCredentialServerUrl,
  sourceContext,
} from "@/providers/jellyfin/shared";

async function parseCredentialsInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createApiError(
      400,
      "invalid_jellyfin_credentials",
      "Provide a JSON object with Jellyfin serverUrl, username, and password",
    );
  }

  const record = body as Record<string, unknown>;
  const serverUrl = stringValue(record.serverUrl);
  const username = stringValue(record.username);

  if (!serverUrl) {
    throw createApiError(
      400,
      "invalid_jellyfin_server_url",
      "Jellyfin serverUrl must be a non-empty string",
    );
  }

  if (!username) {
    throw createApiError(
      400,
      "invalid_jellyfin_username",
      "Jellyfin username must be a non-empty string",
    );
  }

  if (typeof record.password !== "string") {
    throw createApiError(
      400,
      "invalid_jellyfin_password",
      "Jellyfin password must be a string",
    );
  }

  return {
    serverUrl: await resolveCredentialServerUrl(serverUrl),
    username,
    password: record.password,
  };
}

export async function authenticateWithCredentials(body: unknown) {
  const { serverUrl, username, password } = await parseCredentialsInput(body);
  const publicInfo = await fetchPublicSystemInfo({
    baseUrl: serverUrl,
    deviceId: JELLYFIN_DEVICE_ID,
    timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
    errorCode: "jellyfin_server_unreachable",
    failureMessage: "Could not reach that Jellyfin server",
    exposeFailureDetail: false,
  });

  let authResult;
  try {
    authResult = await authenticateJellyfinUser({
      baseUrl: serverUrl,
      username,
      password,
      deviceId: JELLYFIN_DEVICE_ID,
      timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
      errorCode: "jellyfin_auth_failed",
      failureMessage: "Jellyfin sign-in failed",
      exposeFailureDetail: false,
    });
  } catch (err) {
    if (isApiError(err) && err.status === 401) {
      throw createApiError(
        401,
        "invalid_jellyfin_credentials",
        "Incorrect Jellyfin username or password",
      );
    }

    throw err;
  }

  const accessToken = stringValue(authResult?.AccessToken);
  const user = authResult?.User;
  const userId = stringValue(user?.Id);
  const isAdministrator = user?.Policy?.IsAdministrator === true;
  const serverId =
    stringValue(authResult?.ServerId) ?? stringValue(publicInfo?.Id);

  if (!accessToken || !userId || !serverId) {
    throw createApiError(
      502,
      "jellyfin_auth_failed",
      "Jellyfin did not return the server or user details Cliparr needs",
    );
  }

  if (!isAdministrator) {
    throw createApiError(
      403,
      "jellyfin_admin_required",
      "Cliparr needs a Jellyfin administrator account so it can view active sessions across the server",
    );
  }

  const normalizedBaseUrl = normalizeBaseUrl(serverUrl);

  return {
    userToken: accessToken,
    resources: [
      {
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
      } satisfies ProviderResource,
    ],
  };
}

export async function checkSource(source: MediaSource) {
  try {
    const context = sourceContext(source);
    const [publicInfo, currentUser] = await Promise.all([
      fetchPublicSystemInfo({
        baseUrl: context.baseUrl,
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
        message:
          "Cliparr needs a Jellyfin administrator account to read active sessions",
      };
    }

    await fetchSessions(context);

    return {
      ok: true as const,
      name: jellyfinSourceName(publicInfo?.ServerName, context.baseUrl),
      baseUrl: normalizeBaseUrl(context.baseUrl),
      metadata: {
        ...source.metadata,
        product:
          stringValue(publicInfo?.ProductName) ??
          stringValue(source.metadata.product),
        platform:
          stringValue(publicInfo?.Version) ??
          stringValue(source.metadata.platform),
        serverId:
          stringValue(publicInfo?.Id) ?? stringValue(source.metadata.serverId),
        serverName:
          stringValue(publicInfo?.ServerName) ??
          stringValue(source.metadata.serverName),
        version:
          stringValue(publicInfo?.Version) ??
          stringValue(source.metadata.version),
        username:
          stringValue(currentUser?.Name) ??
          stringValue(source.metadata.username),
        userId:
          stringValue(currentUser?.Id) ?? stringValue(source.metadata.userId),
        isAdministrator: true,
      },
    };
  } catch (err) {
    if (isApiError(err)) {
      return {
        ok: false as const,
        message: err.message,
      };
    }

    throw err;
  }
}
