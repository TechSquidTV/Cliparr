import { Router } from "express";
import { listMediaSources } from "../db/mediaSourcesRepository.js";
import { asyncHandler } from "../http/errors.js";
import { requireSession, setNoStore } from "../session/request.js";

export const sourcesRouter = Router();

sourcesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    requireSession(req);
    setNoStore(res);
    res.json({
      sources: listMediaSources().map((source) => ({
        id: source.id,
        providerId: source.providerId,
        providerAccountId: source.providerAccountId,
        externalId: source.externalId,
        name: source.name,
        enabled: source.enabled,
        baseUrl: source.baseUrl,
        connection: source.connection,
        metadata: source.metadata,
        lastCheckedAt: source.lastCheckedAt,
        lastError: source.lastError,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      })),
    });
  })
);
