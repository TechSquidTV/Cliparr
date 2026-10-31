import type { TranscodeDecisionData } from "@cliparr/plex/pms/types";
import type {
  CurrentlyPlayingItem,
  PlaybackProgress,
  PlaybackViewer,
  ProviderAuthStart,
  ProviderAuthStatus,
  ProviderDefinition,
  ProviderSession,
} from "@cliparr/shared/providers";
import type { Request, Response } from "express";

import type { MediaSourceRecord } from "@/db/mediaSourcesRepository";
import type { ProviderSessionRecord } from "@/session/store";

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

export interface CurrentlyPlayingEntry {
  viewer: PlaybackViewer;
  item: CurrentlyPlayingItem;
}

export type PlaybackResolver = (
  session: ProviderSessionRecord,
) => Promise<CurrentlyPlayingEntry[]>;

export interface PlaybackObserver {
  /** Notification transport is open; the initial playback snapshot is still pending. */
  connected: () => void;
  snapshot: (resolve: PlaybackResolver) => void;
  progress: (updates: PlaybackProgress[]) => void;
  invalidate: () => void;
}

interface MediaHandleProviderMetadata {
  plex?: {
    playbackSessionId?: string;
    subtitleStreamId?: string;
    subtitleDecision?: TranscodeDecisionData["query"];
  };
  jellyfin?: {
    deviceId?: string;
  };
}

export interface MediaHandle {
  id: string;
  providerId: string;
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
  /**
  Starts a PIN auth flow. The pollToken travels in the HttpOnly auth cookie,
  never in the JSON body, so the wire type stays ProviderAuthStart.
  */
  startAuth?(
    callbackUrl: string,
  ): Promise<ProviderAuthStart & { pollToken: string }>;
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
  supportsCurrentlyPlayingSource?(source: MediaSourceRecord): boolean;
  checkSource(source: MediaSourceRecord): Promise<ProviderSourceCheckResult>;
  listCurrentlyPlaying(
    session: ProviderSessionRecord,
    source: MediaSourceRecord,
  ): Promise<CurrentlyPlayingEntry[]>;
  watchCurrentlyPlaying(
    source: MediaSourceRecord,
    observer: PlaybackObserver,
    signal: AbortSignal,
  ): Promise<void>;
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
