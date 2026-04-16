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
