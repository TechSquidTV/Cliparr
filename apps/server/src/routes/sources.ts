import { Router } from "express";
import {
  deleteMediaSource,
  getMediaSource,
  listMediaSources,
  updateMediaSource,
  updateMediaSourceHealth,
  type MediaSource,
  type UpdateMediaSourceInput,
} from "../db/mediaSourcesRepository.js";
import { ApiError, asyncHandler } from "../http/errors.js";
import { getProvider } from "../providers/registry.js";
import { requireSession, setNoStore } from "../session/request.js";

export const sourcesRouter = Router();

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
    throw new ApiError(404, "source_not_found", "Source was not found");
  }
  return source;
}

function parseSourceUpdate(body: unknown): UpdateMediaSourceInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "invalid_source_update", "Provide a JSON object with editable source fields");
  }

  const allowedFields = new Set(["enabled", "name"]);
  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!allowedFields.has(key)) {
      throw new ApiError(400, "source_field_not_editable", `${key} cannot be updated here`);
    }
  }

  const input: UpdateMediaSourceInput = {};

  if ("name" in record) {
    if (typeof record.name !== "string" || !record.name.trim()) {
      throw new ApiError(400, "invalid_source_name", "Source name must be a non-empty string");
    }
    input.name = record.name.trim();
  }

  if ("enabled" in record) {
    if (typeof record.enabled !== "boolean") {
      throw new ApiError(400, "invalid_source_enabled", "Source enabled must be true or false");
    }
    input.enabled = record.enabled;
  }

  if (Object.keys(input).length === 0) {
    throw new ApiError(400, "empty_source_update", "Provide at least one editable source field");
  }

  return input;
}

sourcesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    requireSession(req);
    setNoStore(res);
    res.json({
      sources: listMediaSources().map(serializeSource),
    });
  })
);

sourcesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    requireSession(req);
    setNoStore(res);
    const source = requireMediaSource(req.params.id as string);
    res.json({ source: serializeSource(source) });
  })
);

sourcesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    requireSession(req);
    setNoStore(res);
    requireMediaSource(req.params.id as string);
    const source = updateMediaSource(req.params.id as string, parseSourceUpdate(req.body));
    if (!source) {
      throw new ApiError(404, "source_not_found", "Source was not found");
    }
    res.json({ source: serializeSource(source) });
  })
);

sourcesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    requireSession(req);
    setNoStore(res);
    const source = requireMediaSource(req.params.id as string);

    const deleted = deleteMediaSource(source.id);
    if (!deleted) {
      throw new ApiError(404, "source_not_found", "Source was not found");
    }

    res.status(204).end();
  })
);

sourcesRouter.post(
  "/:id/check",
  asyncHandler(async (req, res) => {
    requireSession(req);
    setNoStore(res);

    const source = requireMediaSource(req.params.id as string);
    const provider = getProvider(source.providerId);
    if (!provider) {
      throw new ApiError(500, "provider_not_registered", "Source provider is not registered");
    }

    const checkedAt = new Date().toISOString();
    const result = await provider.checkSource(source);

    if (!result.ok) {
      const updatedSource = updateMediaSourceHealth(source.id, {
        lastCheckedAt: checkedAt,
        lastError: result.message,
      });

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
      return;
    }

    const updatedSource = updateMediaSource(source.id, {
      ...(result.name !== undefined ? { name: result.name } : {}),
      ...(result.baseUrl !== undefined ? { baseUrl: result.baseUrl } : {}),
      ...(result.connection !== undefined ? { connection: result.connection } : {}),
      ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),
      lastCheckedAt: checkedAt,
      lastError: null,
    });

    if (!updatedSource) {
      throw new ApiError(404, "source_not_found", "Source was not found");
    }

    res.json({
      ok: true,
      source: serializeSource(updatedSource),
    });
  })
);
