import type { Request, Response } from "express";
import type {
  CurrentlyPlayingItem,
  PlaybackViewer,
} from "@cliparr/shared/providers";
import type { MediaSource } from "@/db/mediaSourcesRepository";
import type { ProviderSessionRecord } from "@/session/store";

type ProviderId = string;
type ProviderAuthType = "pin" | "credentials";

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  auth: ProviderAuthType;
}

interface ProviderAuthStart {
  authId: string;
  authUrl: string;
  expiresAt: string;
  pollToken: string;
}

type ProviderAuthStatus =
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
  provides?: string[];
  owned?: boolean;
  accessToken: string;
  connections: ProviderConnection[];
  credentials?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface ProviderSession {
  id: string;
  providerId: ProviderId;
  expiresAt: string;
}

export interface CurrentlyPlayingEntry {
  viewer: PlaybackViewer;
  item: CurrentlyPlayingItem;
}

interface MediaHandleProviderMetadata {
  plex?: {
    playbackSessionId?: string;
  };
  jellyfin?: {
    deviceId?: string;
  };
}

export interface MediaHandle {
  id: string;
  providerId: ProviderId;
  sourceId: string;
  baseUrl: string;
  path: string;
  token: string;
  providerMetadata?: MediaHandleProviderMetadata;
  basePath?: string;
  lastAccessedAt: number;
}

type ProviderSourceCheckResult =
  | {
      ok: true;
      name?: string;
      baseUrl?: string;
      connection?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }
  | {
      ok: false;
      message: string;
    };

export interface ProviderImplementation {
  definition: ProviderDefinition;
  startAuth?(callbackUrl: string): Promise<ProviderAuthStart>;
  pollAuth?(
    authId: string,
    pollToken: string,
  ): Promise<{
    status: ProviderAuthStatus["status"];
    userToken?: string;
    resources?: ProviderResource[];
  }>;
  authenticateWithCredentials?(body: unknown): Promise<{
    userToken: string;
    resources: ProviderResource[];
  }>;
  supportsCurrentlyPlayingSource?(source: MediaSource): boolean;
  checkSource(source: MediaSource): Promise<ProviderSourceCheckResult>;
  listCurrentlyPlaying(
    session: ProviderSessionRecord,
    source: MediaSource,
  ): Promise<CurrentlyPlayingEntry[]>;
  proxyMedia(
    session: ProviderSessionRecord,
    handleId: string,
    request: Request,
    res: Response,
  ): Promise<void>;
  serializeSession(session: ProviderSessionRecord): ProviderSession;
}

export {
  type MediaExportMetadata,
  type PlaybackAudioSelection,
  type PlaybackExportEstimateMetadata,
  type PlaybackSubtitleSelection,
  type PlaybackSubtitleTrack,
  type SourcePlaybackError,
  type ViewerPlaybackGroup,
} from "@cliparr/shared/providers";
