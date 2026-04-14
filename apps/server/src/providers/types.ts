import type { Request, Response } from "express";
import type { ProviderSessionRecord } from "../session/store.js";

export type ProviderId = "plex" | string;

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  auth: "pin";
}

export interface ProviderAuthStart {
  authId: string;
  authUrl: string;
  expiresAt: string;
}

export type ProviderAuthStatus =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "complete" };

export interface ProviderConnection {
  id: string;
  uri: string;
  local: boolean;
  relay: boolean;
  protocol?: string;
  address?: string;
  port?: number;
}

export interface ProviderResource {
  id: string;
  name: string;
  product?: string;
  platform?: string;
  owned?: boolean;
  accessToken: string;
  connections: ProviderConnection[];
}

export interface ProviderSession {
  id: string;
  providerId: ProviderId;
  selectedResource?: Omit<ProviderResource, "accessToken">;
  expiresAt: string;
}

export interface MediaSession {
  id: string;
  title: string;
  type: string;
  duration: number;
  userTitle: string;
  playerTitle: string;
  playerState: string;
  thumbUrl?: string;
  mediaUrl?: string;
  previewUrl?: string;
}

export interface MediaHandle {
  id: string;
  providerId: ProviderId;
  resourceId: string;
  path: string;
  token: string;
  basePath?: string;
}

export interface ProviderImplementation {
  definition: ProviderDefinition;
  startAuth(): Promise<ProviderAuthStart>;
  pollAuth(authId: string): Promise<{
    status: ProviderAuthStatus["status"];
    userToken?: string;
    resources?: ProviderResource[];
  }>;
  selectResource(
    session: ProviderSessionRecord,
    resourceId: string,
    connectionId: string
  ): Promise<ProviderResource>;
  listMediaSessions(session: ProviderSessionRecord): Promise<MediaSession[]>;
  proxyMedia(session: ProviderSessionRecord, handleId: string, req: Request, res: Response): Promise<void>;
  serializeSession(session: ProviderSessionRecord): ProviderSession;
}
