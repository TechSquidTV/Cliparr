import { Router } from "express";
import { persistProviderAuth, persistProviderResource } from "../db/providerPersistence.js";
import { ApiError, asyncHandler } from "../http/errors.js";
import { getProvider, listProviders } from "../providers/registry.js";
import type { ProviderResource } from "../providers/types.js";
import { createProviderSession, getSessionCookieHeader } from "../session/store.js";
import { requireProviderSession, setNoStore } from "../session/request.js";
import { updateProviderSessionSelectedResource } from "../session/store.js";

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
      resources: authStatus.resources,
    });

    res.setHeader("Set-Cookie", getSessionCookieHeader(session.id));
    res.json({ status: "complete" });
  })
);

providersRouter.get(
  "/:providerId/resources",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const provider = getProvider(req.params.providerId as string);
    if (!provider) {
      throw new ApiError(404, "provider_not_found", "Provider was not found");
    }

    const session = requireProviderSession(req, req.params.providerId as string);
    res.json({
      resources: (session.resources as any[]).map((resource) => {
        const { accessToken, ...safeResource } = resource;
        return safeResource;
      }),
    });
  })
);

providersRouter.post(
  "/:providerId/resources/select",
  asyncHandler(async (req, res) => {
    setNoStore(res);
    const provider = getProvider(req.params.providerId as string);
    if (!provider) {
      throw new ApiError(404, "provider_not_found", "Provider was not found");
    }

    const { resourceId, connectionId } = req.body ?? {};
    if (typeof resourceId !== "string" || typeof connectionId !== "string") {
      throw new ApiError(400, "invalid_resource_selection", "Select a server and connection");
    }

    const session = requireProviderSession(req, req.params.providerId as string);
    const selectedResource = await provider.selectResource(session, resourceId, connectionId);
    updateProviderSessionSelectedResource(session.id, selectedResource);
    if (session.providerAccountId) {
      const resource = (session.resources as ProviderResource[]).find((candidate) => candidate.id === resourceId);
      const selectedConnection = selectedResource.connections[0];
      if (resource && selectedConnection) {
        persistProviderResource({
          providerId: provider.definition.id,
          providerAccountId: session.providerAccountId,
          resource,
          selectedConnection,
        });
      }
    }
    res.json({ session: provider.serializeSession(session) });
  })
);
