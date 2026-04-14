import type { Request, Response } from "express";
import { ApiError } from "../http/errors.js";
import {
  getProviderSession,
  getSessionCookieName,
  readCookie,
  type ProviderSessionRecord,
} from "./store.js";

export function getRequestSessionId(req: Request) {
  return readCookie(req.header("cookie"), getSessionCookieName());
}

export function requireSession(req: Request): ProviderSessionRecord {
  const session = getProviderSession(getRequestSessionId(req));
  if (!session) {
    throw new ApiError(401, "not_authenticated", "Sign in with a provider first");
  }
  return session;
}

export function requireProviderSession(req: Request, providerId: string) {
  const session = requireSession(req);
  if (session.providerId !== providerId) {
    throw new ApiError(400, "provider_mismatch", "Session does not belong to that provider");
  }
  return session;
}

export function setNoStore(res: Response) {
  res.setHeader("Cache-Control", "no-store");
}
