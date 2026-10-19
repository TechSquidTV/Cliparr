import type {
  AuthenticationResult,
  BaseItemDto,
  MediaSourceInfo,
  MediaStream,
  PlaybackInfoResponse,
  PublicSystemInfo,
  SessionInfoDto,
  UserDto,
} from "@jellyfin/sdk/lib/generated-client/models/index.js";
import {
  getAuthenticationApi,
  getLibraryApi,
  getMediaInfoApi,
  getSessionApi,
  getSystemApi,
  getUserApi,
} from "@jellyfin/sdk/lib/utils/api/index.js";

import type { MediaSourceRecord } from "@/db/mediaSourcesRepository";
import { createApiError } from "@/http/errors";
import {
  isLoopbackHost,
  JELLYFIN_DEVICE_ID,
  JELLYFIN_REQUEST_TIMEOUT_MS,
  jellyfinSdkJson,
  normalizeBaseUrl,
} from "@/providers/jellyfin/http";
import {
  assertHttpUrl,
  numberValue,
  stringValue,
} from "@/providers/shared/utilities";

const CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS = 5000;

export interface JellyfinSourceContext {
  sourceId: string;
  baseUrl: string;
  token: string;
  userId: string;
  deviceId: string;
}

export type JellyfinMediaStream = Omit<MediaStream, "Type"> & {
  Type?: string;
};

export type JellyfinMediaSource = Omit<MediaSourceInfo, "MediaStreams"> & {
  MediaStreams?: JellyfinMediaStream[] | null;
};

type JellyfinStudio = NonNullable<
  NonNullable<BaseItemDto["Studios"]>[number]
> & {
  name?: string | null;
};

export type JellyfinItem = Omit<
  BaseItemDto,
  "MediaSources" | "MediaType" | "Studios" | "Type"
> & {
  MediaSources?: JellyfinMediaSource[] | null;
  MediaType?: string;
  Studios?: JellyfinStudio[] | null;
  Type?: string;
};

export type JellyfinSessionInfo = Omit<
  SessionInfoDto,
  "NowPlayingItem" | "PlayState"
> & {
  NowPlayingItem?: JellyfinItem | null;
  PlayState?: SessionInfoDto["PlayState"] | null;
};

export type JellyfinPlaybackInfo = Omit<
  PlaybackInfoResponse,
  "MediaSources"
> & {
  MediaSources?: JellyfinMediaSource[];
};

export type JellyfinPublicSystemInfo = PublicSystemInfo;
export type JellyfinUser = UserDto;
export type JellyfinAuthenticationResult = AuthenticationResult;

function sourceHostInfo(baseUrl: string) {
  const parsed = assertHttpUrl(baseUrl, "Jellyfin");
  const hostname = parsed.hostname.trim();
  if (!hostname) {
    return;
  }

  const port = parsed.port ? numberValue(parsed.port) : undefined;
  const isDefaultHttp =
    parsed.protocol === "http:" && (port === undefined || port === 80);
  const isDefaultHttps =
    parsed.protocol === "https:" && (port === undefined || port === 443);
  const label =
    port === undefined || isDefaultHttp || isDefaultHttps
      ? hostname
      : `${hostname}:${port}`;

  return {
    hostname,
    label,
  };
}

function looksLikeGeneratedServerName(value: string) {
  return /^[\da-f]{12,64}$/i.test(value.trim());
}

export function jellyfinSourceName(
  serverName: string | null | undefined,
  baseUrl: string,
) {
  const normalizedServerName = stringValue(serverName);
  if (
    normalizedServerName &&
    !looksLikeGeneratedServerName(normalizedServerName)
  ) {
    return normalizedServerName;
  }

  const hostInfo = sourceHostInfo(baseUrl);
  if (
    !hostInfo ||
    hostInfo.hostname.toLowerCase() === "jellyfin" ||
    isLoopbackHost(hostInfo.hostname)
  ) {
    return "Jellyfin";
  }

  return `Jellyfin (${hostInfo.label})`;
}

function isLocalConnection(url: URL) {
  const host = url.hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

export function connectionInfo(baseUrl: string) {
  const parsed = assertHttpUrl(baseUrl, "Jellyfin");
  return {
    id: parsed.toString(),
    uri: baseUrl,
    local: isLocalConnection(parsed),
    relay: false,
    protocol: parsed.protocol.slice(0, -1),
    address: parsed.hostname,
    port: numberValue(parsed.port) ?? (parsed.protocol === "https:" ? 443 : 80),
  };
}

export function sourceContext(
  source: MediaSourceRecord,
): JellyfinSourceContext {
  const token = stringValue(source.credentials.accessToken);
  const userId =
    stringValue(source.credentials.userId) ??
    stringValue(source.metadata.userId);
  const deviceId =
    stringValue(source.credentials.deviceId) ?? JELLYFIN_DEVICE_ID;

  if (!token) {
    throw createApiError(
      500,
      "source_credentials_missing",
      "Stored Jellyfin source is missing its access token",
    );
  }

  if (!userId) {
    throw createApiError(
      500,
      "source_credentials_missing",
      "Stored Jellyfin source is missing its Jellyfin user id",
    );
  }

  return {
    sourceId: source.id,
    baseUrl: normalizeBaseUrl(source.baseUrl),
    token,
    userId,
    deviceId,
  };
}

export async function fetchCurrentUser(
  context: JellyfinSourceContext,
  signal?: AbortSignal,
) {
  return jellyfinSdkJson<JellyfinUser>(
    context.baseUrl,
    (api, config) => getUserApi(api).getCurrentUser(config),
    {
      token: context.token,
      deviceId: context.deviceId,
      timeoutMs: JELLYFIN_REQUEST_TIMEOUT_MS,
      errorCode: "jellyfin_auth_failed",
      signal,
      failureMessage: "Jellyfin authentication failed",
    },
  );
}

export async function fetchPublicSystemInfo(options: {
  signal?: AbortSignal;
  baseUrl: string;
  deviceId?: string;
  timeoutMs?: number;
  errorCode?: string;
  failureMessage?: string;
  exposeFailureDetail?: boolean;
}) {
  return jellyfinSdkJson<JellyfinPublicSystemInfo>(
    options.baseUrl,
    (api, config) => getSystemApi(api).getPublicSystemInfo(config),
    {
      deviceId: options.deviceId,
      timeoutMs: options.timeoutMs,
      errorCode: options.errorCode,
      failureMessage: options.failureMessage,
      exposeFailureDetail: options.exposeFailureDetail,
      signal: options.signal,
    },
  );
}

export async function authenticateJellyfinUser(options: {
  baseUrl: string;
  username: string;
  password: string;
  deviceId?: string;
  timeoutMs?: number;
  errorCode?: string;
  failureMessage?: string;
  exposeFailureDetail?: boolean;
}) {
  return jellyfinSdkJson<JellyfinAuthenticationResult>(
    options.baseUrl,
    (api, config) =>
      getAuthenticationApi(api).authenticateUserByName(
        {
          authenticateUserByName: {
            Username: options.username,
            Pw: options.password,
          },
        },
        config,
      ),
    {
      deviceId: options.deviceId,
      timeoutMs: options.timeoutMs,
      errorCode: options.errorCode,
      failureMessage: options.failureMessage,
      exposeFailureDetail: options.exposeFailureDetail,
    },
  );
}

export async function fetchSessions(
  context: JellyfinSourceContext,
  signal?: AbortSignal,
) {
  return jellyfinSdkJson<JellyfinSessionInfo[]>(
    context.baseUrl,
    (api, config) =>
      getSessionApi(api).getSessions(
        {
          activeWithinSeconds: 300,
        },
        config,
      ),
    {
      token: context.token,
      deviceId: context.deviceId,
      timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
      errorCode: "jellyfin_sessions_failed",
      signal,
      failureMessage: "Jellyfin sessions request failed",
    },
  );
}

export async function fetchItem(
  context: JellyfinSourceContext,
  itemId: string,
) {
  return jellyfinSdkJson<JellyfinItem>(
    context.baseUrl,
    (api, config) =>
      getLibraryApi(api).getItem(
        {
          itemId,
          userId: context.userId,
        },
        config,
      ),
    {
      token: context.token,
      deviceId: context.deviceId,
      timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
      errorCode: "jellyfin_item_failed",
      failureMessage: "Jellyfin item request failed",
    },
  );
}

export async function fetchPlaybackInfo(
  context: JellyfinSourceContext,
  itemId: string,
) {
  return jellyfinSdkJson<JellyfinPlaybackInfo>(
    context.baseUrl,
    (api, config) =>
      getMediaInfoApi(api).getPlaybackInfo(
        {
          itemId,
          userId: context.userId,
        },
        config,
      ),
    {
      token: context.token,
      deviceId: context.deviceId,
      timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
      errorCode: "jellyfin_playback_info_failed",
      failureMessage: "Jellyfin playback info request failed",
    },
  );
}
