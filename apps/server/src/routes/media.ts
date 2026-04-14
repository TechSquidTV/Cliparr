import { Router } from "express";
import { ApiError, asyncHandler } from "../http/errors.js";
import { getProvider } from "../providers/registry.js";
import { requireSession, setNoStore } from "../session/request.js";

export const mediaRouter = Router();

mediaRouter.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const session = requireSession(req);
    const provider = getProvider(session.providerId);
    if (!provider) {
      throw new ApiError(500, "provider_not_registered", "Session provider is not registered");
    }

    res.json({ sessions: await provider.listMediaSessions(session) });
  })
);

mediaRouter.get(
  "/:handleId",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const session = requireSession(req);
    const provider = getProvider(session.providerId);
    if (!provider) {
      throw new ApiError(500, "provider_not_registered", "Session provider is not registered");
    }

    await provider.proxyMedia(session, req.params.handleId as string, req, res);
  })
);
