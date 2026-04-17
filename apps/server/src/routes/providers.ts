import { Router } from "express";
import { persistProviderAuth } from "../db/providerPersistence.js";
import { ApiError, asyncHandler } from "../http/errors.js";
import { getProvider, listProviders } from "../providers/registry.js";
import { createProviderSession, getSessionCookieHeader } from "../session/store.js";
import { setNoStore } from "../session/request.js";

export const providersRouter = Router();

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

    res.json(await provider.startAuth());
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

    const authStatus = await provider.pollAuth(req.params.authId as string);
    if (authStatus.status !== "complete") {
      res.json({ status: authStatus.status });
      return;
    }

    if (!authStatus.userToken || !authStatus.resources) {
      throw new ApiError(502, "provider_auth_failed", "Provider auth did not return credentials");
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

    res.setHeader("Set-Cookie", getSessionCookieHeader(session.id));
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
      throw new ApiError(502, "provider_auth_failed", "Provider auth did not return credentials");
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

    res.setHeader("Set-Cookie", getSessionCookieHeader(session.id));
    res.json({
      session: provider.serializeSession(session),
    });
  })
);
