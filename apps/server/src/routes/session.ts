import { Router } from "express";
import {
  compactLogFields,
  logDurationFields,
  logEventFields,
} from "@cliparr/shared/logging";
import {
  createRememberedProviderSession,
  getRememberedProviderSession,
  revokeRememberedProviderSession,
} from "#/db/rememberedProviderSessionsRepository.js";
import { ApiError, asyncHandler } from "#/http/errors.js";
import { getProvider } from "#/providers/registry.js";
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
} from "#/session/store.js";
import { getRequestSessionId, setNoStore } from "#/session/request.js";
import { getServerLogger } from "#/logging.js";

export const sessionRouter = Router();
const logger = getServerLogger("session");

sessionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const startedAt = Date.now();
    const rememberedToken = readCookie(
      req.header("cookie"),
      getRememberedProviderSessionCookieName(),
    );
    const rememberedSession = getRememberedProviderSession(rememberedToken);
    const requestSessionId = getRequestSessionId(req);
    const cookieSession = getProviderSession(requestSessionId);
    const session =
      cookieSession ??
      restoreProviderSessionFromProviderAccount(
        rememberedSession?.providerAccountId,
      );
    if (!session) {
      if (rememberedToken) {
        revokeRememberedProviderSession(rememberedToken);
        res.clearCookie(
          getRememberedProviderSessionCookieName(),
          getRememberedProviderSessionCookieClearOptions(req.secure),
        );
        logger.info("Remembered provider session was revoked.", {
          ...logEventFields("session.restore", "failure"),
          ...logDurationFields(startedAt),
          "session.remembered.present": true,
        });
      }
      throw new ApiError(
        401,
        "not_authenticated",
        "Sign in with a provider first",
      );
    }

    const provider = getProvider(session.providerId);
    if (!provider) {
      throw new ApiError(
        500,
        "provider_not_registered",
        "Session provider is not registered",
      );
    }

    const rememberedSessionMatches =
      rememberedSession?.providerAccountId === session.providerAccountId;
    const nextRememberedSession = rememberedSessionMatches
      ? undefined
      : createRememberedProviderSession(session.providerAccountId);
    if (rememberedToken && rememberedSession && !rememberedSessionMatches) {
      revokeRememberedProviderSession(rememberedToken);
    }

    res.cookie(
      getSessionCookieName(),
      session.id,
      getSessionCookieOptions(req.secure),
    );
    if (nextRememberedSession) {
      res.cookie(
        getRememberedProviderSessionCookieName(),
        nextRememberedSession.token,
        getRememberedProviderSessionCookieOptions(req.secure),
      );
    }
    res.json({ session: provider.serializeSession(session) });

    if (!cookieSession && rememberedSession) {
      logger.info("Provider session restored.", {
        ...logEventFields("session.restore", "success"),
        ...logDurationFields(startedAt),
        "provider.id": session.providerId,
        "provider.account.id": session.providerAccountId,
        "session.id": session.id,
      });
    }
  }),
);

sessionRouter.delete("/", (req, res) => {
  setNoStore(res);
  const session = getProviderSession(getRequestSessionId(req));
  const rememberedToken = readCookie(
    req.header("cookie"),
    getRememberedProviderSessionCookieName(),
  );
  revokeRememberedProviderSession(rememberedToken);
  deleteProviderSession(getRequestSessionId(req));
  res.clearCookie(
    getSessionCookieName(),
    getSessionCookieClearOptions(req.secure),
  );
  res.clearCookie(
    getRememberedProviderSessionCookieName(),
    getRememberedProviderSessionCookieClearOptions(req.secure),
  );
  res.status(204).end();

  logger.info("Provider session logged out.", {
    ...logEventFields("session.logout", "success"),
    ...compactLogFields({
      "provider.id": session?.providerId,
      "provider.account.id": session?.providerAccountId,
      "session.id": session?.id,
      "session.remembered.present": Boolean(rememberedToken),
    }),
  });
});
