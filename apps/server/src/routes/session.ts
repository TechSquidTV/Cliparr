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
} from "@/db/rememberedProviderSessionsRepository";
import { deleteProviderAccount } from "@/db/providerAccountsRepository";
import { asyncHandler, createApiError } from "@/http/errors";
import { getProvider } from "@/providers/registry";
import {
  deleteProviderSession,
  deleteProviderSessionsForProviderAccount,
  getRememberedProviderSessionCookieClearOptions,
  getRememberedProviderSessionCookieName,
  getRememberedProviderSessionCookieOptions,
  getSessionCookieClearOptions,
  getSessionCookieName,
  getSessionCookieOptions,
  getProviderSession,
  readCookie,
  restoreProviderSessionFromProviderAccount,
} from "@/session/store";
import { getRequestSessionId, setNoStore } from "@/session/request";
import { getServerLogger } from "@/logging";

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
      throw createApiError(
        401,
        "not_authenticated",
        "Sign in with a provider first",
      );
    }

    const provider = getProvider(session.providerId);
    if (!provider) {
      throw createApiError(
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
  const startedAt = Date.now();
  const requestSessionId = getRequestSessionId(req);
  const session = getProviderSession(requestSessionId);
  const rememberedToken = readCookie(
    req.header("cookie"),
    getRememberedProviderSessionCookieName(),
  );
  const rememberedSession = getRememberedProviderSession(rememberedToken);
  const providerAccountId =
    session?.providerAccountId ?? rememberedSession?.providerAccountId;
  revokeRememberedProviderSession(rememberedToken);
  let deletedSessionCount = 0;
  if (providerAccountId) {
    deletedSessionCount =
      deleteProviderSessionsForProviderAccount(providerAccountId);
  } else {
    deleteProviderSession(requestSessionId);
  }
  const deletedProviderAccount = providerAccountId
    ? deleteProviderAccount(providerAccountId)
    : false;
  res.clearCookie(
    getSessionCookieName(),
    getSessionCookieClearOptions(req.secure),
  );
  res.clearCookie(
    getRememberedProviderSessionCookieName(),
    getRememberedProviderSessionCookieClearOptions(req.secure),
  );
  res.status(204).end();

  logger.info("Provider account disconnected.", {
    ...logEventFields("session.disconnect", "success"),
    ...logDurationFields(startedAt),
    ...compactLogFields({
      "provider.id": session?.providerId,
      "provider.account.id": providerAccountId,
      "session.id": session?.id,
      "session.deleted_count": deletedSessionCount,
      "session.remembered.present": Boolean(rememberedToken),
      "provider.account.deleted": deletedProviderAccount,
    }),
  });
});
