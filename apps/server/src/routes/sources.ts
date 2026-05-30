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
  deleteMediaSourceForAccount,
  getMediaSourceForAccount,
  updateMediaSourceHealthForAccount,
  type MediaSource,
  type UpdateMediaSourceInput,
  updateMediaSourceForAccount,
} from "../db/mediaSourcesRepository.js";
import { ApiError, asyncHandler } from "../http/errors.js";
import {
  PLEX_BASE_URL_MODE_MANUAL,
  withPlexBaseUrlMode,
} from "../providers/plex/connectionState.js";
import { getProvider } from "../providers/registry.js";
import { requireAccountSession, setNoStore } from "../session/request.js";
import { getServerLogger, warnWithError } from "../logging.js";

export const sourcesRouter = Router();
const logger = getServerLogger(["routes", "sources"]);

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

function requireMediaSource(sourceId: string, providerAccountId: string) {
  const source = getMediaSourceForAccount(sourceId, providerAccountId);
  if (!source) {
    throw new ApiError(404, "source_not_found", "Source was not found");
  }
  return source;
}

function parseSourceBaseUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(
      400,
      "invalid_source_base_url",
      "Source URL must be a non-empty string",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ApiError(
      400,
      "invalid_source_base_url",
      "Source URL must be a valid HTTP or HTTPS URL",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError(
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
    throw new ApiError(
      400,
      "invalid_source_update",
      "Provide a JSON object with editable source fields",
    );
  }

  const allowedFields = new Set(["baseUrl", "enabled", "name"]);
  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!allowedFields.has(key)) {
      throw new ApiError(
        400,
        "source_field_not_editable",
        `${key} cannot be updated here`,
      );
    }
  }

  const input: UpdateMediaSourceInput = {};

  if ("name" in record) {
    if (typeof record.name !== "string" || !record.name.trim()) {
      throw new ApiError(
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
      throw new ApiError(
        400,
        "invalid_source_enabled",
        "Source enabled must be true or false",
      );
    }
    input.enabled = record.enabled;
  }

  if (Object.keys(input).length === 0) {
    throw new ApiError(
      400,
      "empty_source_update",
      "Provide at least one editable source field",
    );
  }

  return input;
}

function changedSourceFields(input: UpdateMediaSourceInput) {
  return Object.keys(input).sort();
}

sourcesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const session = requireAccountSession(req);
    setNoStore(res);
    res.json({
      sources: listMediaSources({
        providerAccountId: session.providerAccountId,
      }).map(serializeSource),
    });
  }),
);

sourcesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const session = requireAccountSession(req);
    setNoStore(res);
    const source = requireMediaSource(
      req.params.id as string,
      session.providerAccountId,
    );
    res.json({ source: serializeSource(source) });
  }),
);

sourcesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const session = requireAccountSession(req);
    setNoStore(res);
    const startedAt = Date.now();
    const sourceId = req.params.id as string;

    try {
      const existingSource = requireMediaSource(
        sourceId,
        session.providerAccountId,
      );
      const input = parseSourceUpdate(req.body);
      const nextInput =
        existingSource.providerId === "plex" && input.baseUrl !== undefined
          ? {
              ...input,
              connection: withPlexBaseUrlMode(
                existingSource.connection,
                PLEX_BASE_URL_MODE_MANUAL,
              ),
            }
          : input;
      const source = updateMediaSourceForAccount(
        sourceId,
        session.providerAccountId,
        nextInput,
      );
      if (!source) {
        throw new ApiError(404, "source_not_found", "Source was not found");
      }
      res.json({ source: serializeSource(source) });

      logger.info("Media source updated.", {
        ...logEventFields("source.update", "success"),
        ...logDurationFields(startedAt),
        "source.id": source.id,
        "provider.id": source.providerId,
        "provider.account.id": session.providerAccountId,
        "source.changed_fields": changedSourceFields(input),
        "source.base_url": sanitizeUrlForLog(input.baseUrl),
      });
    } catch (err) {
      warnWithError(
        logger,
        err,
        "Media source update failed.",
        compactLogFields({
          ...logEventFields("source.update", "failure"),
          ...logDurationFields(startedAt),
          ...logErrorFields(err),
          "source.id": sourceId,
          "provider.account.id": session.providerAccountId,
          "http.status_code": err instanceof ApiError ? err.status : undefined,
        }),
      );
      throw err;
    }
  }),
);

sourcesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const session = requireAccountSession(req);
    setNoStore(res);
    const startedAt = Date.now();
    const sourceId = req.params.id as string;

    try {
      const source = requireMediaSource(sourceId, session.providerAccountId);
      const deleted = deleteMediaSourceForAccount(
        sourceId,
        session.providerAccountId,
      );
      if (!deleted) {
        throw new ApiError(404, "source_not_found", "Source was not found");
      }

      res.status(204).end();

      logger.info("Media source deleted.", {
        ...logEventFields("source.delete", "success"),
        ...logDurationFields(startedAt),
        "source.id": source.id,
        "provider.id": source.providerId,
        "provider.account.id": session.providerAccountId,
      });
    } catch (err) {
      warnWithError(
        logger,
        err,
        "Media source delete failed.",
        compactLogFields({
          ...logEventFields("source.delete", "failure"),
          ...logDurationFields(startedAt),
          ...logErrorFields(err),
          "source.id": sourceId,
          "provider.account.id": session.providerAccountId,
          "http.status_code": err instanceof ApiError ? err.status : undefined,
        }),
      );
      throw err;
    }
  }),
);

sourcesRouter.post(
  "/:id/check",
  asyncHandler(async (req, res) => {
    const session = requireAccountSession(req);
    setNoStore(res);
    const startedAt = Date.now();
    const sourceId = req.params.id as string;

    try {
      const source = requireMediaSource(sourceId, session.providerAccountId);
      const provider = getProvider(source.providerId);
      if (!provider) {
        throw new ApiError(
          500,
          "provider_not_registered",
          "Source provider is not registered",
        );
      }

      const checkedAt = new Date().toISOString();
      const result = await provider.checkSource(source);

      if (!result.ok) {
        const updatedSource = updateMediaSourceHealthForAccount(
          source.id,
          session.providerAccountId,
          {
            lastCheckedAt: checkedAt,
            lastError: result.message,
          },
        );

        if (!updatedSource) {
          throw new ApiError(404, "source_not_found", "Source was not found");
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
          "provider.account.id": session.providerAccountId,
          "source.health.ok": false,
          "error.message": result.message,
        });
        return;
      }

      const updatedSource = updateMediaSourceForAccount(
        source.id,
        session.providerAccountId,
        {
          ...(result.name !== undefined ? { name: result.name } : {}),
          ...(result.baseUrl !== undefined ? { baseUrl: result.baseUrl } : {}),
          ...(result.connection !== undefined
            ? { connection: result.connection }
            : {}),
          ...(result.metadata !== undefined
            ? { metadata: result.metadata }
            : {}),
          lastCheckedAt: checkedAt,
          lastError: null,
        },
      );

      if (!updatedSource) {
        throw new ApiError(404, "source_not_found", "Source was not found");
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
        "provider.account.id": session.providerAccountId,
        "source.health.ok": true,
        "source.base_url": sanitizeUrlForLog(result.baseUrl),
      });
    } catch (err) {
      warnWithError(
        logger,
        err,
        "Media source health check failed.",
        compactLogFields({
          ...logEventFields("source.check", "failure"),
          ...logDurationFields(startedAt),
          ...logErrorFields(err),
          "source.id": sourceId,
          "provider.account.id": session.providerAccountId,
          "http.status_code": err instanceof ApiError ? err.status : undefined,
        }),
      );
      throw err;
    }
  }),
);
