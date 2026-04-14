import { randomUUID } from "crypto";

const SESSION_COOKIE = "cliparr_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export interface ProviderSessionRecord {
  id: string;
  providerId: string;
  userToken: string;
  resources: unknown[];
  selectedResource?: unknown;
  mediaHandles: Map<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, ProviderSessionRecord>();

export function createProviderSession(input: {
  providerId: string;
  userToken: string;
  resources: unknown[];
}) {
  const now = Date.now();
  const session: ProviderSessionRecord = {
    id: randomUUID(),
    providerId: input.providerId,
    userToken: input.userToken,
    resources: input.resources,
    mediaHandles: new Map(),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(session.id, session);
  return session;
}

export function getProviderSession(sessionId?: string) {
  if (!sessionId) {
    return undefined;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return undefined;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return undefined;
  }

  return session;
}

export function deleteProviderSession(sessionId?: string) {
  if (sessionId) {
    sessions.delete(sessionId);
  }
}

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export function getSessionCookieHeader(sessionId: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}${secure}`;
}

export function getClearSessionCookieHeader() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function readCookie(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) {
    return undefined;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const match = cookies.find((cookie) => cookie.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}
