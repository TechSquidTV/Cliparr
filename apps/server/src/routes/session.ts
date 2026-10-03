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
  rotateRememberedProviderSession,
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
  asyncHandler(async (request, res) => {
    setNoStore(res);
    const startedAt = Date.now();
    const rememberedToken = readCookie(
      request.header("cookie"),
      getRememberedProviderSessionCookieName(),
    );
    const rememberedSession = getRememberedProviderSession(rememberedToken);
    const requestSessionId = getRequestSessionId(request);
    const cookieSession = getProviderSession(requestSessionId);
    const session =
      cookieSession ??
      restoreProviderSessionFromProviderAccount(
        rememberedSession?.providerAccountId,
      );
    if (!session) {
      // Another restore may already have refreshed the browser's shared
      // cookies. A failed request must not erase those newer credentials.
      if (rememberedToken) {
        revokeRememberedProviderSession(rememberedToken);
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

    // Rotate only after a successful restore, so failure cannot orphan a fresh
    // token that the client never receives.
    let rotatedRememberedToken: string | undefined;
    if (!cookieSession && rememberedToken && rememberedSession) {
      const rotated = rotateRememberedProviderSession(rememberedToken);
      if (rotated) {
        rotatedRememberedToken = rotated.token;
      }
      // A lost rotation race must also leave the shared remember cookie alone.
      // The session established above still authenticates this request.
    }

    res.cookie(
      getSessionCookieName(),
      session.id,
      getSessionCookieOptions(request.secure),
    );
    const nextRememberedToken =
      nextRememberedSession?.token ?? rotatedRememberedToken;
    if (nextRememberedToken) {
      res.cookie(
        getRememberedProviderSessionCookieName(),
        nextRememberedToken,
        getRememberedProviderSessionCookieOptions(request.secure),
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

sessionRouter.delete("/", (request, res) => {
  setNoStore(res);
  const startedAt = Date.now();
  const requestSessionId = getRequestSessionId(request);
  const session = getProviderSession(requestSessionId);
  const rememberedToken = readCookie(
    request.header("cookie"),
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
    getSessionCookieClearOptions(request.secure),
  );
  res.clearCookie(
    getRememberedProviderSessionCookieName(),
    getRememberedProviderSessionCookieClearOptions(request.secure),
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
