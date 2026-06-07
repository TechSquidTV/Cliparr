import { Router } from "express";
import {
  compactLogFields,
  logDurationFields,
  logErrorFields,
  logEventFields,
} from "@cliparr/shared/logging";
import { listMediaSources } from "@/db/mediaSourcesRepository";
import { asyncHandler, createApiError, isApiError } from "@/http/errors";
import { getServerLogger, warnWithError } from "@/logging";
import { probePlexHlsSessionIdentities } from "@/providers/plex/playback";
import { requireAccountSession, setNoStore } from "@/session/request";

export const debugRouter = Router();

const logger = getServerLogger(["provider", "plex", "playback"]);
const PLEX_HLS_PROBE_ENV = "CLIPARR_ENABLE_PLEX_HLS_PROBE";

function plexHlsProbeEnabled() {
  return process.env[PLEX_HLS_PROBE_ENV] === "1";
}

function requestedSourceId(body: unknown) {
  if (!body || typeof body !== "object") {
    return;
  }

  const sourceId = (body as { sourceId?: unknown }).sourceId;
  return typeof sourceId === "string" && sourceId.trim()
    ? sourceId.trim()
    : undefined;
}

debugRouter.post(
  "/plex/hls-probe",
  asyncHandler(async (request, res) => {
    setNoStore(res);
    if (!plexHlsProbeEnabled()) {
      throw createApiError(404, "debug_not_found", "Debug route was not found");
    }

    const startedAt = Date.now();
    const session = requireAccountSession(request);
    const sourceId = requestedSourceId(request.body);
    const sources = listMediaSources({
      enabledOnly: true,
      providerId: "plex",
      providerAccountId: session.providerAccountId,
    });
    const source = sourceId
      ? sources.find((candidate) => candidate.id === sourceId)
      : sources[0];
    if (!source) {
      throw createApiError(
        404,
        "plex_hls_probe_source_not_found",
        "No enabled Plex source was found for this session",
      );
    }

    try {
      const result = await probePlexHlsSessionIdentities(session, source);
      res.json(result);

      logger.info("Plex HLS probe completed.", {
        ...logEventFields("debug.plex_hls_probe", "success"),
        ...logDurationFields(startedAt),
        "session.id": session.id,
        "provider.account.id": session.providerAccountId,
        "source.id": source.id,
      });
    } catch (error) {
      warnWithError(
        logger,
        error,
        "Plex HLS probe failed.",
        compactLogFields({
          ...logEventFields("debug.plex_hls_probe", "failure"),
          ...logDurationFields(startedAt),
          ...logErrorFields(error),
          "session.id": session.id,
          "provider.account.id": session.providerAccountId,
          "source.id": source.id,
          "http.status_code": isApiError(error) ? error.status : undefined,
        }),
      );
      throw error;
    }
  }),
);
