import type { Request, Response } from "express";
import type { MediaSource } from "../db/mediaSourcesRepository.js";
import type { ProviderSessionRecord } from "../session/store.js";

export type ProviderId = string;
export type ProviderAuthType = "pin" | "credentials";

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  auth: ProviderAuthType;
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
  provides?: string[];
  owned?: boolean;
  accessToken: string;
  connections: ProviderConnection[];
  credentials?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ProviderSession {
  id: string;
  providerId: ProviderId;
  expiresAt: string;
}

export interface PlaybackViewer {
  id: string;
  providerId: ProviderId;
  externalId?: string;
  name: string;
  avatarUrl?: string;
}

export interface PlaybackSource {
  id: string;
  name: string;
  providerId: ProviderId;
}

export interface MediaExportMetadata {
  providerId: ProviderId;
  itemType: string;
  title?: string;
  sourceTitle?: string;
  showTitle?: string;
  seasonTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  year?: number;
  date?: string;
  description?: string;
  tagline?: string;
  studio?: string;
  network?: string;
  contentRating?: string;
  genres?: string[];
  directors?: string[];
  writers?: string[];
  actors?: string[];
  guids?: string[];
  ratingKey?: string;
  imageUrl?: string;
}

export interface PlaybackAudioSelection {
  trackNumber?: number;
  languageCode?: string;
  title?: string;
}

export interface CurrentlyPlayingItem {
  id: string;
  source: PlaybackSource;
  title: string;
  type: string;
  duration: number;
  playerTitle: string;
  playerState: string;
  thumbUrl?: string;
  mediaUrl?: string;
  previewUrl?: string;
  selectedAudioTrack?: PlaybackAudioSelection;
  exportMetadata?: MediaExportMetadata;
}

export interface CurrentlyPlayingEntry {
  viewer: PlaybackViewer;
  item: CurrentlyPlayingItem;
}

export interface ViewerPlaybackGroup {
  viewer: PlaybackViewer;
  items: CurrentlyPlayingItem[];
}

export interface SourcePlaybackError {
  sourceId: string;
  sourceName: string;
  providerId: ProviderId;
  message: string;
}

export interface MediaHandle {
  id: string;
  providerId: ProviderId;
  sourceId: string;
  baseUrl: string;
  path: string;
  token: string;
  deviceId?: string;
  basePath?: string;
  lastAccessedAt: number;
}

export type ProviderSourceCheckResult =
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
  pollAuth?(authId: string): Promise<{
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
  listCurrentlyPlaying(session: ProviderSessionRecord, source: MediaSource): Promise<CurrentlyPlayingEntry[]>;
  proxyMedia(session: ProviderSessionRecord, handleId: string, req: Request, res: Response): Promise<void>;
  serializeSession(session: ProviderSessionRecord): ProviderSession;
}
