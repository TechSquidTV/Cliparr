import { Router } from "express";
import { persistProviderAuth } from "../db/providerPersistence.js";
import { createRememberedProviderSession } from "../db/rememberedProviderSessionsRepository.js";
import { ApiError, asyncHandler } from "../http/errors.js";
import { getRequestRouteUrl } from "../http/requestOrigin.js";
import { getProvider, listProviders } from "../providers/registry.js";
import {
  createProviderSession,
  getRememberedProviderSessionCookieName,
  getRememberedProviderSessionCookieOptions,
  getSessionCookieName,
  getSessionCookieOptions,
  readCookie,
} from "../session/store.js";
import { setNoStore } from "../session/request.js";

export const providersRouter = Router();
const PROVIDER_AUTH_COMPLETE_PATH = (providerId: string) => `/auth/${providerId}/complete`;
const PROVIDER_AUTH_COOKIE = "cliparr_provider_auth";

interface ProviderAuthCookie {
  providerId: string;
  authId: string;
  pollToken: string;
}

function providerAuthCookieOptions(secure: boolean, expiresAt: string) {
  return {
    path: "/api/providers",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    maxAge: Math.max(0, new Date(expiresAt).getTime() - Date.now()),
  };
}

function providerAuthCookieClearOptions(secure: boolean) {
  return {
    path: "/api/providers",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
  };
}

function encodeProviderAuthCookie(payload: ProviderAuthCookie) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeProviderAuthCookie(value: string | undefined): ProviderAuthCookie | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ProviderAuthCookie>;
    if (
      typeof payload.providerId === "string"
      && typeof payload.authId === "string"
      && typeof payload.pollToken === "string"
    ) {
      return {
        providerId: payload.providerId,
        authId: payload.authId,
        pollToken: payload.pollToken,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function requireProviderAuthCookie(
  cookieHeader: string | undefined,
  providerId: string,
  authId: string
) {
  const authCookie = decodeProviderAuthCookie(readCookie(cookieHeader, PROVIDER_AUTH_COOKIE));
  if (authCookie?.providerId !== providerId || authCookie.authId !== authId) {
    throw new ApiError(
      401,
      "invalid_provider_auth_session",
      "Provider sign-in must be completed from the browser that started it"
    );
  }

  return authCookie;
}

providersRouter.get("/", (_req, res) => {
  setNoStore(res);
  res.json({ providers: listProviders() });
});

providersRouter.post(
  "/:providerId/auth/start",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const provider = getProvider(req.params.providerId as string);
    if (!provider) {
      throw new ApiError(404, "provider_not_found", "Provider was not found");
    }

    if (provider.definition.auth !== "pin" || !provider.startAuth) {
      throw new ApiError(400, "provider_auth_not_supported", "This provider does not use browser PIN sign-in");
    }

    const authStart = await provider.startAuth(
      getRequestRouteUrl(req, PROVIDER_AUTH_COMPLETE_PATH(provider.definition.id))
    );

    res.cookie(
      PROVIDER_AUTH_COOKIE,
      encodeProviderAuthCookie({
        providerId: provider.definition.id,
        authId: authStart.authId,
        pollToken: authStart.pollToken,
      }),
      providerAuthCookieOptions(req.secure, authStart.expiresAt)
    );

    res.json({
      authId: authStart.authId,
      authUrl: authStart.authUrl,
      expiresAt: authStart.expiresAt,
    });
  })
);

providersRouter.get(
  "/:providerId/auth/:authId",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const provider = getProvider(req.params.providerId as string);
    if (!provider) {
      throw new ApiError(404, "provider_not_found", "Provider was not found");
    }

    if (provider.definition.auth !== "pin" || !provider.pollAuth) {
      throw new ApiError(400, "provider_auth_not_supported", "This provider does not use browser PIN sign-in");
    }

    const authId = req.params.authId as string;
    const authCookie = requireProviderAuthCookie(req.header("cookie"), provider.definition.id, authId);
    const authStatus = await provider.pollAuth(authId, authCookie.pollToken);
    if (authStatus.status !== "complete") {
      if (authStatus.status === "expired") {
        res.clearCookie(PROVIDER_AUTH_COOKIE, providerAuthCookieClearOptions(req.secure));
      }
      res.json({ status: authStatus.status });
      return;
    }

    if (!authStatus.userToken || !Array.isArray(authStatus.resources) || authStatus.resources.length === 0) {
      throw new ApiError(502, "provider_auth_failed", "Provider auth did not return any available servers");
    }

    const account = persistProviderAuth({
      provider: provider.definition,
      userToken: authStatus.userToken,
      resources: authStatus.resources,
    });

    const session = createProviderSession({
      providerId: provider.definition.id,
      providerAccountId: account.id,
      userToken: authStatus.userToken,
    });

    const rememberedSession = createRememberedProviderSession(session.providerAccountId);

    res.clearCookie(PROVIDER_AUTH_COOKIE, providerAuthCookieClearOptions(req.secure));
    res.cookie(getSessionCookieName(), session.id, getSessionCookieOptions(req.secure));
    res.cookie(
      getRememberedProviderSessionCookieName(),
      rememberedSession.token,
      getRememberedProviderSessionCookieOptions(req.secure)
    );
    res.json({ status: "complete" });
  })
);

providersRouter.post(
  "/:providerId/auth/login",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const provider = getProvider(req.params.providerId as string);
    if (!provider) {
      throw new ApiError(404, "provider_not_found", "Provider was not found");
    }

    if (provider.definition.auth !== "credentials" || !provider.authenticateWithCredentials) {
      throw new ApiError(400, "provider_auth_not_supported", "This provider does not use direct credential sign-in");
    }

    const authResult = await provider.authenticateWithCredentials(req.body);
    if (
      !authResult.userToken
      || !Array.isArray(authResult.resources)
      || authResult.resources.length === 0
    ) {
      throw new ApiError(502, "provider_auth_failed", "Provider auth did not return any available servers");
    }

    const account = persistProviderAuth({
      provider: provider.definition,
      userToken: authResult.userToken,
      resources: authResult.resources,
    });

    const session = createProviderSession({
      providerId: provider.definition.id,
      providerAccountId: account.id,
      userToken: authResult.userToken,
    });

    const rememberedSession = createRememberedProviderSession(session.providerAccountId);

    res.cookie(getSessionCookieName(), session.id, getSessionCookieOptions(req.secure));
    res.cookie(
      getRememberedProviderSessionCookieName(),
      rememberedSession.token,
      getRememberedProviderSessionCookieOptions(req.secure)
    );
    res.json({
      session: provider.serializeSession(session),
    });
  })
);
