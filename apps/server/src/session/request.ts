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

function requireSession(req: Request): ProviderSessionRecord {
  const session = getProviderSession(getRequestSessionId(req));
  if (!session) {
    throw new ApiError(401, "not_authenticated", "Sign in with a provider first");
  }
  return session;
}

export function requireAccountSession(req: Request): ProviderSessionRecord {
  return requireSession(req);
}

export function setNoStore(res: Response) {
  res.setHeader("Cache-Control", "no-store");
}
