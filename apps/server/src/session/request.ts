import type { Request } from "express";

import { getSessionCookieName, readCookie } from "@/http/cookies";
import { createApiError } from "@/http/errors";
import {
  getProviderSession,
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
