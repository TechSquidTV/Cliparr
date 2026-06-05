import { Router } from "express";
import {
  compactLogFields,
  logDurationFields,
  logErrorFields,
  logEventFields,
} from "@cliparr/shared/logging";
import { persistProviderAuth } from "@/db/providerPersistence";
import { createRememberedProviderSession } from "@/db/rememberedProviderSessionsRepository";
import { asyncHandler, createApiError, isApiError } from "@/http/errors";
import { getRequestRouteUrl } from "@/http/requestOrigin";
import { getProvider, listProviders } from "@/providers/registry";
import { getServerLogger, warnWithError } from "@/logging";
import {
  createProviderSession,
  getRememberedProviderSessionCookieName,
  getRememberedProviderSessionCookieOptions,
  getSessionCookieName,
  getSessionCookieOptions,
  readCookie,
} from "@/session/store";
import { setNoStore } from "@/session/request";

export const providersRouter = Router();
const logger = getServerLogger(["provider", "auth"]);
const PROVIDER_AUTH_COMPLETE_PATH = (providerId: string) =>
  `/auth/${providerId}/complete`;
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

function decodeProviderAuthCookie(
  value: string | undefined,
): ProviderAuthCookie | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<ProviderAuthCookie>;
    if (
      typeof payload.providerId === "string" &&
      typeof payload.authId === "string" &&
      typeof payload.pollToken === "string"
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
  authId: string,
) {
  const authCookie = decodeProviderAuthCookie(
    readCookie(cookieHeader, PROVIDER_AUTH_COOKIE),
  );
  if (authCookie?.providerId !== providerId || authCookie.authId !== authId) {
    throw createApiError(
      401,
      "invalid_provider_auth_session",
      "Provider sign-in must be completed from the browser that started it",
    );
  }

  return authCookie;
}

providersRouter.get("/", (_request, res) => {
  setNoStore(res);
  res.json({ providers: listProviders() });
});

providersRouter.post(
  "/:providerId/auth/start",
  asyncHandler(async (request, res) => {
    setNoStore(res);
    const provider = getProvider(request.params.providerId as string);
    if (!provider) {
      throw createApiError(404, "provider_not_found", "Provider was not found");
    }

    if (provider.definition.auth !== "pin" || !provider.startAuth) {
      throw createApiError(
        400,
        "provider_auth_not_supported",
        "This provider does not use browser PIN sign-in",
      );
    }

    const startedAt = Date.now();
    let authStart: Awaited<ReturnType<NonNullable<typeof provider.startAuth>>>;
    try {
      authStart = await provider.startAuth(
        getRequestRouteUrl(
          request,
          PROVIDER_AUTH_COMPLETE_PATH(provider.definition.id),
        ),
      );
    } catch (error) {
      logger.warn("Provider auth start failed.", {
        ...logEventFields("provider.auth.start", "failure"),
        ...logDurationFields(startedAt),
        ...logErrorFields(error),
        "provider.id": provider.definition.id,
        "provider.auth.method": "pin",
      });
      throw error;
    }

    res.cookie(
      PROVIDER_AUTH_COOKIE,
      encodeProviderAuthCookie({
        providerId: provider.definition.id,
        authId: authStart.authId,
        pollToken: authStart.pollToken,
      }),
      providerAuthCookieOptions(request.secure, authStart.expiresAt),
    );

    res.json({
      authId: authStart.authId,
      authUrl: authStart.authUrl,
      expiresAt: authStart.expiresAt,
    });

    logger.info("Provider auth started.", {
      ...logEventFields("provider.auth.start", "success"),
      ...logDurationFields(startedAt),
      "provider.id": provider.definition.id,
      "provider.auth.method": "pin",
    });
  }),
);

providersRouter.get(
  "/:providerId/auth/:authId",
  asyncHandler(async (request, res) => {
    setNoStore(res);
    const provider = getProvider(request.params.providerId as string);
    if (!provider) {
      throw createApiError(404, "provider_not_found", "Provider was not found");
    }

    if (provider.definition.auth !== "pin" || !provider.pollAuth) {
      throw createApiError(
        400,
        "provider_auth_not_supported",
        "This provider does not use browser PIN sign-in",
      );
    }

    const authId = request.params.authId as string;
    const startedAt = Date.now();

    try {
      const authCookie = requireProviderAuthCookie(
        request.header("cookie"),
        provider.definition.id,
        authId,
      );
      const authStatus = await provider.pollAuth(authId, authCookie.pollToken);
      if (authStatus.status !== "complete") {
        if (authStatus.status === "expired") {
          res.clearCookie(
            PROVIDER_AUTH_COOKIE,
            providerAuthCookieClearOptions(request.secure),
          );
          logger.info("Provider auth expired.", {
            ...logEventFields("provider.auth.poll", "expired"),
            ...logDurationFields(startedAt),
            "provider.id": provider.definition.id,
            "provider.auth.method": "pin",
          });
        }
        res.json({ status: authStatus.status });
        return;
      }

      if (
        !authStatus.userToken ||
        !Array.isArray(authStatus.resources) ||
        authStatus.resources.length === 0
      ) {
        throw createApiError(
          502,
          "provider_auth_failed",
          "Provider auth did not return any available servers",
        );
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

      const rememberedSession = createRememberedProviderSession(
        session.providerAccountId,
      );

      res.clearCookie(
        PROVIDER_AUTH_COOKIE,
        providerAuthCookieClearOptions(request.secure),
      );
      res.cookie(
        getSessionCookieName(),
        session.id,
        getSessionCookieOptions(request.secure),
      );
      res.cookie(
        getRememberedProviderSessionCookieName(),
        rememberedSession.token,
        getRememberedProviderSessionCookieOptions(request.secure),
      );
      res.json({ status: "complete" });

      logger.info("Provider auth completed.", {
        ...logEventFields("provider.auth.poll", "success"),
        ...logDurationFields(startedAt),
        "provider.id": provider.definition.id,
        "provider.auth.method": "pin",
        "provider.account.id": account.id,
        "provider.resource.count": authStatus.resources.length,
        "session.id": session.id,
      });
    } catch (error) {
      warnWithError(
        logger,
        error,
        "Provider auth poll failed.",
        compactLogFields({
          ...logEventFields("provider.auth.poll", "failure"),
          ...logDurationFields(startedAt),
          ...logErrorFields(error),
          "provider.id": provider.definition.id,
          "provider.auth.method": "pin",
          "http.status_code": isApiError(error) ? error.status : undefined,
        }),
      );
      throw error;
    }
  }),
);

providersRouter.post(
  "/:providerId/auth/login",
  asyncHandler(async (request, res) => {
    setNoStore(res);
    const provider = getProvider(request.params.providerId as string);
    if (!provider) {
      throw createApiError(404, "provider_not_found", "Provider was not found");
    }

    if (
      provider.definition.auth !== "credentials" ||
      !provider.authenticateWithCredentials
    ) {
      throw createApiError(
        400,
        "provider_auth_not_supported",
        "This provider does not use direct credential sign-in",
      );
    }

    const startedAt = Date.now();

    try {
      const authResult = await provider.authenticateWithCredentials(
        request.body,
      );
      if (
        !authResult.userToken ||
        !Array.isArray(authResult.resources) ||
        authResult.resources.length === 0
      ) {
        throw createApiError(
          502,
          "provider_auth_failed",
          "Provider auth did not return any available servers",
        );
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

      const rememberedSession = createRememberedProviderSession(
        session.providerAccountId,
      );

      res.cookie(
        getSessionCookieName(),
        session.id,
        getSessionCookieOptions(request.secure),
      );
      res.cookie(
        getRememberedProviderSessionCookieName(),
        rememberedSession.token,
        getRememberedProviderSessionCookieOptions(request.secure),
      );
      res.json({
        session: provider.serializeSession(session),
      });

      logger.info("Provider credential login completed.", {
        ...logEventFields("provider.auth.login", "success"),
        ...logDurationFields(startedAt),
        "provider.id": provider.definition.id,
        "provider.auth.method": "credentials",
        "provider.account.id": account.id,
        "provider.resource.count": authResult.resources.length,
        "session.id": session.id,
      });
    } catch (error) {
      warnWithError(
        logger,
        error,
        "Provider credential login failed.",
        compactLogFields({
          ...logEventFields("provider.auth.login", "failure"),
          ...logDurationFields(startedAt),
          ...logErrorFields(error),
          "provider.id": provider.definition.id,
          "provider.auth.method": "credentials",
          "http.status_code": isApiError(error) ? error.status : undefined,
        }),
      );
      throw error;
    }
  }),
);
