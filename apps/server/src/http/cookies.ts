import { REMEMBERED_PROVIDER_SESSION_TTL_MS } from "@/db/rememberedProviderSessionsRepository";
import { SESSION_TTL_MS } from "@/session/constants";

const SESSION_COOKIE = "cliparr_session";
const REMEMBERED_PROVIDER_SESSION_COOKIE = "cliparr_remember";

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export function getRememberedProviderSessionCookieName() {
  return REMEMBERED_PROVIDER_SESSION_COOKIE;
}

export function getSessionCookieOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    maxAge: SESSION_TTL_MS,
  };
}

export function getRememberedProviderSessionCookieOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    maxAge: REMEMBERED_PROVIDER_SESSION_TTL_MS,
  };
}

export function getSessionCookieClearOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
  };
}

export function getRememberedProviderSessionCookieClearOptions(
  secure: boolean,
) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
  };
}

export function readCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) {
    return;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const match = cookies.find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}
