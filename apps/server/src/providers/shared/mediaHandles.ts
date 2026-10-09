import { randomUUID } from "node:crypto";
import { logEventFields } from "@cliparr/shared/logging";
import { getServerLogger } from "@/logging";
import type { MediaHandle } from "@/providers/types";
import type { ProviderSessionRecord } from "@/session/store";
import {
  hlsSegmentIndex,
  hlsUriKind,
  isAbsoluteUrl,
  isHlsDerivedHandle,
  normalizeMediaPath,
  sanitizeLoggedMediaPath,
} from "@/providers/shared/mediaUrlPolicy";

const logger = getServerLogger(["media", "proxy"]);

interface MediaHandleContext {
  providerId: MediaHandle["providerId"];
  sourceId: string;
  baseUrl: string;
  token: string;
  providerMetadata?: MediaHandle["providerMetadata"];
}

interface CreateMediaHandleOptions {
  basePath?: string;
}

const mediaHandleIndexes = new WeakMap<
  Map<string, MediaHandle>,
  Map<string, string>
>();

function normalizeProviderMetadata(
  metadata: MediaHandle["providerMetadata"],
): MediaHandle["providerMetadata"] {
  const normalized: NonNullable<MediaHandle["providerMetadata"]> = {};

  if (
    metadata?.plex?.playbackSessionId !== undefined ||
    metadata?.plex?.subtitleStreamId !== undefined
  ) {
    normalized.plex = {
      playbackSessionId: metadata.plex.playbackSessionId,
      subtitleStreamId: metadata.plex.subtitleStreamId,
      subtitleDecision: metadata.plex.subtitleDecision,
    };
  }

  if (metadata?.jellyfin?.deviceId !== undefined) {
    normalized.jellyfin = {
      deviceId: metadata.jellyfin.deviceId,
    };
  }

  return normalized.plex || normalized.jellyfin ? normalized : undefined;
}

function providerMetadataKey(metadata: MediaHandle["providerMetadata"]) {
  return JSON.stringify(normalizeProviderMetadata(metadata) ?? {});
}

function mediaHandleDedupKey(
  handle: Pick<
    MediaHandle,
    | "providerId"
    | "sourceId"
    | "baseUrl"
    | "path"
    | "token"
    | "providerMetadata"
    | "basePath"
  >,
) {
  // Includes secret token material: this key must never be logged.
  return JSON.stringify([
    handle.providerId,
    handle.sourceId,
    handle.baseUrl,
    handle.path,
    handle.token,
    providerMetadataKey(handle.providerMetadata),
    handle.basePath,
  ]);
}

export function removeMediaHandleFromIndex(
  handles: Map<string, MediaHandle>,
  handle: MediaHandle,
) {
  const index = mediaHandleIndexes.get(handles);
  if (!index) {
    return;
  }
  const key = mediaHandleDedupKey(handle);
  if (index.get(key) === handle.id) {
    index.delete(key);
  }
}

export function mediaHandleLogFields(
  session: ProviderSessionRecord,
  handle: MediaHandle,
  basePath = handle.basePath,
) {
  return {
    "media.handle.id": handle.id,
    "session.id": session.id,
    "provider.id": handle.providerId,
    "source.id": handle.sourceId,
    "media.path": sanitizeLoggedMediaPath(handle.path),
    "media.base_path": sanitizeLoggedMediaPath(basePath),
    ...mediaHandleHlsLogFields(handle),
  };
}

export function createProviderMediaHandle(
  session: ProviderSessionRecord,
  context: MediaHandleContext,
  path: string,
  options: CreateMediaHandleOptions = {},
) {
  const normalizedPath = normalizeMediaPath(path);
  const normalizedBasePath = options.basePath
    ? normalizeMediaPath(options.basePath)
    : undefined;
  const providerMetadata = normalizeProviderMetadata(context.providerMetadata);
  const dedupKey = mediaHandleDedupKey({
    ...context,
    path: normalizedPath,
    providerMetadata,
    basePath: normalizedBasePath,
  });
  let index = mediaHandleIndexes.get(session.mediaHandles);
  if (!index) {
    index = new Map<string, string>();
    mediaHandleIndexes.set(session.mediaHandles, index);
  }
  const existingHandleId = index.get(dedupKey);
  const existingHandle = existingHandleId
    ? session.mediaHandles.get(existingHandleId)
    : undefined;
  const accessedAt = Date.now();

  if (existingHandle) {
    existingHandle.lastAccessedAt = accessedAt;
    logger.trace("Reused provider media handle.", {
      ...logEventFields("media.handle", "reused"),
      ...mediaHandleLogFields(session, existingHandle, normalizedBasePath),
    });
    return `/api/media/${existingHandle.id}`;
  }

  const handle: MediaHandle = {
    id: randomUUID(),
    providerId: context.providerId,
    sourceId: context.sourceId,
    baseUrl: context.baseUrl,
    path: normalizedPath,
    token: context.token,
    providerMetadata,
    basePath: normalizedBasePath,
    lastAccessedAt: accessedAt,
  };
  session.mediaHandles.set(handle.id, handle);
  index.set(dedupKey, handle.id);
  logger.trace("Created provider media handle.", {
    ...logEventFields("media.handle", "created"),
    ...mediaHandleLogFields(session, handle),
    "media.path.absolute": isAbsoluteUrl(handle.path),
  });
  return `/api/media/${handle.id}`;
}

export function mediaHandleHlsLogFields(handle: MediaHandle) {
  const isHlsDerived = isHlsDerivedHandle(handle);
  return {
    "media.hls.derived": isHlsDerived,
    "media.hls.uri.kind": isHlsDerived ? hlsUriKind(handle.path) : undefined,
    "media.hls.segment.index": isHlsDerived
      ? hlsSegmentIndex(handle.path)
      : undefined,
  };
}
