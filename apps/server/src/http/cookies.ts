import {
  REMEMBERED_PROVIDER_SESSION_TTL_MS,
  SESSION_TTL_MS,
} from "@/session/constants";

export const CREDENTIAL_COOKIE_NAMES = {
  session: "cliparr_session",
  rememberedSession: "cliparr_remember",
  providerAuth: "cliparr_provider_auth",
} as const;

export function getSessionCookieOptions(secure: boolean) {
  return {
    ...getSessionCookieClearOptions(secure),
    maxAge: SESSION_TTL_MS,
  };
}

export function getRememberedProviderSessionCookieOptions(secure: boolean) {
  return {
    ...getSessionCookieClearOptions(secure),
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

export function readCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) {
    return;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const match = cookies.find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}
