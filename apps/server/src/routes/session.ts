import { Router } from "express";
import {
  createRememberedProviderSession,
  getRememberedProviderSession,
  revokeRememberedProviderSession,
} from "../db/rememberedProviderSessionsRepository.js";
import { ApiError, asyncHandler } from "../http/errors.js";
import { getProvider } from "../providers/registry.js";
import {
  deleteProviderSession,
  getRememberedProviderSessionCookieClearOptions,
  getRememberedProviderSessionCookieName,
  getRememberedProviderSessionCookieOptions,
  getSessionCookieClearOptions,
  getSessionCookieName,
  getSessionCookieOptions,
  getProviderSession,
  readCookie,
  restoreProviderSessionFromProviderAccount,
} from "../session/store.js";
import { getRequestSessionId, setNoStore } from "../session/request.js";

export const sessionRouter = Router();

sessionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const rememberedToken = readCookie(
      req.header("cookie"),
      getRememberedProviderSessionCookieName()
    );
    const rememberedSession = getRememberedProviderSession(rememberedToken);
    const session = getProviderSession(getRequestSessionId(req))
      ?? restoreProviderSessionFromProviderAccount(rememberedSession?.providerAccountId);
    if (!session) {
      if (rememberedToken) {
        revokeRememberedProviderSession(rememberedToken);
        res.clearCookie(
          getRememberedProviderSessionCookieName(),
          getRememberedProviderSessionCookieClearOptions(req.secure)
        );
      }
      throw new ApiError(401, "not_authenticated", "Sign in with a provider first");
    }

    const provider = getProvider(session.providerId);
    if (!provider) {
      throw new ApiError(500, "provider_not_registered", "Session provider is not registered");
    }

    const rememberedSessionMatches = rememberedSession?.providerAccountId === session.providerAccountId;
    const nextRememberedSession = rememberedSessionMatches
      ? undefined
      : createRememberedProviderSession(session.providerAccountId);
    if (rememberedToken && rememberedSession && !rememberedSessionMatches) {
      revokeRememberedProviderSession(rememberedToken);
    }

    res.cookie(getSessionCookieName(), session.id, getSessionCookieOptions(req.secure));
    if (nextRememberedSession) {
      res.cookie(
        getRememberedProviderSessionCookieName(),
        nextRememberedSession.token,
        getRememberedProviderSessionCookieOptions(req.secure)
      );
    }
    res.json({ session: provider.serializeSession(session) });
  })
);

sessionRouter.delete("/", (req, res) => {
  setNoStore(res);
  revokeRememberedProviderSession(readCookie(
    req.header("cookie"),
    getRememberedProviderSessionCookieName()
  ));
  deleteProviderSession(getRequestSessionId(req));
  res.clearCookie(getSessionCookieName(), getSessionCookieClearOptions(req.secure));
  res.clearCookie(
    getRememberedProviderSessionCookieName(),
    getRememberedProviderSessionCookieClearOptions(req.secure)
  );
  res.status(204).end();
});
