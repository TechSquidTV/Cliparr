import type { Request, Response } from "express";
import { createApiError } from "@/http/errors";
import {
  getProviderSession,
  getSessionCookieName,
  readCookie,
  type ProviderSessionRecord,
} from "@/session/store";

export function getRequestSessionId(request: Request) {
  return readCookie(request.header("cookie"), getSessionCookieName());
}

function requireSession(request: Request): ProviderSessionRecord {
  const session = getProviderSession(getRequestSessionId(request));
  if (!session) {
    throw createApiError(
      401,
      "not_authenticated",
      "Sign in with a provider first",
    );
  }
  return session;
}

export function requireAccountSession(request: Request): ProviderSessionRecord {
  return requireSession(request);
}

export function setNoStore(res: Response) {
  res.setHeader("Cache-Control", "no-store");
}
