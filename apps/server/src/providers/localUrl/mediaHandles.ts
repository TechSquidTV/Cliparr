import { randomUUID } from "node:crypto";
import { createApiError } from "@/http/errors";
import type { MediaHandle } from "@/providers/types";
import {
  pruneSessionMediaHandles,
  type ProviderSessionRecord,
} from "@/session/store";

export const LOCAL_URL_PROVIDER_ID = "local-url";
const LOCAL_URL_SOURCE_ID = "remote-url";

const LOCAL_URL_MEDIA_BASE_URL = "http://cliparr.local";
const HLS_PLAYLIST_PATTERN = /\.m3u8(?:$|[#?])/i;

const localUrlMediaHandles = new Map<string, MediaHandle>();

export const localUrlSession: ProviderSessionRecord = {
  id: "local-url",
  providerId: LOCAL_URL_PROVIDER_ID,
  providerAccountId: LOCAL_URL_SOURCE_ID,
  userToken: "",
  mediaHandles: localUrlMediaHandles,
  createdAt: 0,
  expiresAt: Number.MAX_SAFE_INTEGER,
};

export function pruneLocalUrlMediaHandles() {
  return pruneSessionMediaHandles(localUrlSession);
}

export function getLocalUrlMediaHandle(handleId: string) {
  return localUrlMediaHandles.get(handleId);
}

function localUrlMediaPath(handleId: string) {
  return `/api/media/local-url/${handleId}`;
}

export function isHlsPlaylistUrl(url: string) {
  return HLS_PLAYLIST_PATTERN.test(url);
}

function parseLocalMediaUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw createApiError(
      400,
      "local_media_url_invalid",
      "Media URL is required",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw createApiError(
      400,
      "local_media_url_invalid",
      "Enter a valid absolute media URL",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createApiError(
      400,
      "local_media_url_invalid",
      "Media URL must use HTTP or HTTPS",
    );
  }

  return parsed;
}

export function bodyUrl(value: unknown) {
  const body =
    value && typeof value === "object" ? (value as { url?: unknown }) : null;
  if (typeof body?.url !== "string") {
    throw createApiError(
      400,
      "local_media_url_invalid",
      "Media URL is required",
    );
  }

  return body.url;
}

export function buildLocalUrlMediaHandle(
  value: string,
  basePath?: string,
): MediaHandle {
  const url = parseLocalMediaUrl(value);

  return {
    id: randomUUID(),
    providerId: LOCAL_URL_PROVIDER_ID,
    sourceId: LOCAL_URL_SOURCE_ID,
    baseUrl: LOCAL_URL_MEDIA_BASE_URL,
    path: url.toString(),
    token: "",
    basePath,
    lastAccessedAt: Date.now(),
  };
}

export function storeLocalUrlMediaHandle(handle: MediaHandle) {
  localUrlMediaHandles.set(handle.id, handle);
  return localUrlMediaPath(handle.id);
}
