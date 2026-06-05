import { Router } from "express";
import {
  compactLogFields,
  logDurationFields,
  logErrorFields,
  logEventFields,
  sanitizeUrlForLog,
} from "@cliparr/shared/logging";
import {
  listMediaSources,
  deleteMediaSource,
  getMediaSource,
  type MediaSource,
  type UpdateMediaSourceInput,
  updateMediaSource,
} from "@/db/mediaSourcesRepository";
import { asyncHandler, createApiError, isApiError } from "@/http/errors";
import {
  PLEX_BASE_URL_MODE_MANUAL,
  withPlexBaseUrlMode,
} from "@/providers/plex/connectionState";
import { getProvider } from "@/providers/registry";
import { requireAccountSession, setNoStore } from "@/session/request";
import { getServerLogger, warnWithError } from "@/logging";

export const sourcesRouter = Router();
const logger = getServerLogger("source");

function serializeSource(source: MediaSource) {
  return {
    id: source.id,
    providerId: source.providerId,
    name: source.name,
    enabled: source.enabled,
    baseUrl: source.baseUrl,
    metadata: source.metadata,
    lastCheckedAt: source.lastCheckedAt ?? null,
    lastError: source.lastError ?? null,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function requireMediaSource(sourceId: string) {
  const source = getMediaSource(sourceId);
  if (!source) {
    throw createApiError(404, "source_not_found", "Source was not found");
  }
  return source;
}

function parseSourceBaseUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw createApiError(
      400,
      "invalid_source_base_url",
      "Source URL must be a non-empty string",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw createApiError(
      400,
      "invalid_source_base_url",
      "Source URL must be a valid HTTP or HTTPS URL",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createApiError(
      400,
      "invalid_source_base_url",
      "Source URL must use HTTP or HTTPS",
    );
  }

  parsed.search = "";
  parsed.hash = "";

  const normalized = parsed.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function parseSourceUpdate(body: unknown): UpdateMediaSourceInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createApiError(
      400,
      "invalid_source_update",
      "Provide a JSON object with editable source fields",
    );
  }

  const allowedFields = new Set(["baseUrl", "enabled", "name"]);
  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!allowedFields.has(key)) {
      throw createApiError(
        400,
        "source_field_not_editable",
        `${key} cannot be updated here`,
      );
    }
  }

  const input: UpdateMediaSourceInput = {};

  if ("name" in record) {
    if (typeof record.name !== "string" || !record.name.trim()) {
      throw createApiError(
        400,
        "invalid_source_name",
        "Source name must be a non-empty string",
      );
    }
    input.name = record.name.trim();
  }

  if ("baseUrl" in record) {
    input.baseUrl = parseSourceBaseUrl(record.baseUrl);
  }

  if ("enabled" in record) {
    if (typeof record.enabled !== "boolean") {
      throw createApiError(
        400,
        "invalid_source_enabled",
        "Source enabled must be true or false",
      );
    }
    input.enabled = record.enabled;
  }

  if (Object.keys(input).length === 0) {
    throw createApiError(
      400,
      "empty_source_update",
      "Provide at least one editable source field",
    );
  }

  return input;
}

function changedSourceFields(input: UpdateMediaSourceInput) {
  return Object.keys(input).toSorted();
}

sourcesRouter.get(
  "/",
  asyncHandler(async (request, res) => {
    requireAccountSession(request);
    setNoStore(res);
    res.json({
      sources: listMediaSources().map((source) => serializeSource(source)),
    });
  }),
);

sourcesRouter.get(
  "/:id",
  asyncHandler(async (request, res) => {
    requireAccountSession(request);
    setNoStore(res);
    const source = requireMediaSource(request.params.id as string);
    res.json({ source: serializeSource(source) });
  }),
);

sourcesRouter.patch(
  "/:id",
  asyncHandler(async (request, res) => {
    const session = requireAccountSession(request);
    setNoStore(res);
    const startedAt = Date.now();
    const sourceId = request.params.id as string;
    let source: MediaSource | undefined;

    try {
      source = requireMediaSource(sourceId);
      const input = parseSourceUpdate(request.body);
      const nextInput =
        source.providerId === "plex" && input.baseUrl !== undefined
          ? {
              ...input,
              connection: withPlexBaseUrlMode(
                source.connection,
                PLEX_BASE_URL_MODE_MANUAL,
              ),
            }
          : input;
      const updatedSource = updateMediaSource(sourceId, nextInput);
      if (!updatedSource) {
        throw createApiError(404, "source_not_found", "Source was not found");
      }
      res.json({ source: serializeSource(updatedSource) });

      logger.info("Media source updated.", {
        ...logEventFields("source.update", "success"),
        ...logDurationFields(startedAt),
        "source.id": updatedSource.id,
        "provider.id": updatedSource.providerId,
        "provider.account.id": updatedSource.providerAccountId,
        "source.changed_fields": changedSourceFields(input),
        "source.base_url": sanitizeUrlForLog(input.baseUrl),
      });
    } catch (error) {
      warnWithError(
        logger,
        error,
        "Media source update failed.",
        compactLogFields({
          ...logEventFields("source.update", "failure"),
          ...logDurationFields(startedAt),
          ...logErrorFields(error),
          "source.id": sourceId,
          "provider.id": source?.providerId,
          "provider.account.id": source?.providerAccountId,
          "session.provider.account.id": session.providerAccountId,
          "http.status_code": isApiError(error) ? error.status : undefined,
        }),
      );
      throw error;
    }
  }),
);

sourcesRouter.delete(
  "/:id",
  asyncHandler(async (request, res) => {
    const session = requireAccountSession(request);
    setNoStore(res);
    const startedAt = Date.now();
    const sourceId = request.params.id as string;
    let source: MediaSource | undefined;

    try {
      source = requireMediaSource(sourceId);
      const deleted = deleteMediaSource(sourceId);
      if (!deleted) {
        throw createApiError(404, "source_not_found", "Source was not found");
      }

      res.status(204).end();

      logger.info("Media source deleted.", {
        ...logEventFields("source.delete", "success"),
        ...logDurationFields(startedAt),
        "source.id": source.id,
        "provider.id": source.providerId,
        "provider.account.id": source.providerAccountId,
      });
    } catch (error) {
      warnWithError(
        logger,
        error,
        "Media source delete failed.",
        compactLogFields({
          ...logEventFields("source.delete", "failure"),
          ...logDurationFields(startedAt),
          ...logErrorFields(error),
          "source.id": sourceId,
          "provider.id": source?.providerId,
          "provider.account.id": source?.providerAccountId,
          "session.provider.account.id": session.providerAccountId,
          "http.status_code": isApiError(error) ? error.status : undefined,
        }),
      );
      throw error;
    }
  }),
);

sourcesRouter.post(
  "/:id/check",
  asyncHandler(async (request, res) => {
    const session = requireAccountSession(request);
    setNoStore(res);
    const startedAt = Date.now();
    const sourceId = request.params.id as string;
    let source: MediaSource | undefined;

    try {
      source = requireMediaSource(sourceId);
      const provider = getProvider(source.providerId);
      if (!provider) {
        throw createApiError(
          500,
          "provider_not_registered",
          "Source provider is not registered",
        );
      }

      const checkedAt = new Date().toISOString();
      const result = await provider.checkSource(source);

      if (!result.ok) {
        const updatedSource = updateMediaSource(source.id, {
          lastCheckedAt: checkedAt,
          lastError: result.message,
        });

        if (!updatedSource) {
          throw createApiError(404, "source_not_found", "Source was not found");
        }

        res.json({
          ok: false,
          error: {
            message: result.message,
          },
          source: serializeSource(updatedSource),
        });

        logger.warn("Media source health check failed.", {
          ...logEventFields("source.check", "failure"),
          ...logDurationFields(startedAt),
          "source.id": source.id,
          "provider.id": source.providerId,
          "provider.account.id": source.providerAccountId,
          "source.health.ok": false,
          "error.message": result.message,
        });
        return;
      }

      const updatedSource = updateMediaSource(source.id, {
        ...(result.name === undefined ? {} : { name: result.name }),
        ...(result.baseUrl === undefined ? {} : { baseUrl: result.baseUrl }),
        ...(result.connection === undefined
          ? {}
          : { connection: result.connection }),
        ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
        lastCheckedAt: checkedAt,
        lastError: null,
      });

      if (!updatedSource) {
        throw createApiError(404, "source_not_found", "Source was not found");
      }

      res.json({
        ok: true,
        source: serializeSource(updatedSource),
      });

      logger.info("Media source health check completed.", {
        ...logEventFields("source.check", "success"),
        ...logDurationFields(startedAt),
        "source.id": source.id,
        "provider.id": source.providerId,
        "provider.account.id": source.providerAccountId,
        "source.health.ok": true,
        "source.base_url": sanitizeUrlForLog(result.baseUrl),
      });
    } catch (error) {
      warnWithError(
        logger,
        error,
        "Media source health check failed.",
        compactLogFields({
          ...logEventFields("source.check", "failure"),
          ...logDurationFields(startedAt),
          ...logErrorFields(error),
          "source.id": sourceId,
          "provider.id": source?.providerId,
          "provider.account.id": source?.providerAccountId,
          "session.provider.account.id": session.providerAccountId,
          "http.status_code": isApiError(error) ? error.status : undefined,
        }),
      );
      throw error;
    }
  }),
);
