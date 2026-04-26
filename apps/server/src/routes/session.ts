import { Router } from "express";
import { ApiError, asyncHandler } from "../http/errors.js";
import { requestUsesSecureTransport } from "../http/requestOrigin.js";
import { getProvider } from "../providers/registry.js";
import {
  deleteProviderSession,
  getClearSessionCookieHeader,
  getProviderSession,
} from "../session/store.js";
import { getRequestSessionId, setNoStore } from "../session/request.js";

export const sessionRouter = Router();

sessionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const session = getProviderSession(getRequestSessionId(req));
    if (!session) {
      throw new ApiError(401, "not_authenticated", "Sign in with a provider first");
    }

    const provider = getProvider(session.providerId);
    if (!provider) {
      throw new ApiError(500, "provider_not_registered", "Session provider is not registered");
    }

    res.json({ session: provider.serializeSession(session) });
  })
);

sessionRouter.delete("/", (req, res) => {
  setNoStore(res);
  deleteProviderSession(getRequestSessionId(req));
  res.setHeader("Set-Cookie", getClearSessionCookieHeader({
    secure: requestUsesSecureTransport(req),
  }));
  res.status(204).end();
});
