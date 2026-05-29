import type {
  SourcePlaybackError,
  ViewerPlaybackGroup,
} from "@cliparr/shared/providers";

export type {
  CurrentlyPlayingItem,
  MediaExportMetadata,
  PlaybackAudioSelection,
  PlaybackSource,
  PlaybackSubtitleSelection,
  PlaybackSubtitleTrack,
  SourcePlaybackError,
  ViewerPlaybackGroup,
} from "@cliparr/shared/providers";

export interface ProviderDefinition {
  id: string;
  name: string;
  auth: "pin" | "credentials";
}

export interface ProviderAuthStart {
  authId: string;
  authUrl: string;
  expiresAt: string;
}

export interface ProviderAuthStatus {
  status: "pending" | "complete" | "expired";
}

export interface ProviderSession {
  id: string;
  providerId: string;
  expiresAt: string;
}

export interface MediaSource {
  id: string;
  providerId: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  metadata: Record<string, unknown>;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaSourceCheckResult {
  ok: boolean;
  source: MediaSource;
  error?: {
    message: string;
  };
}

export interface CurrentlyPlayingResponse {
  viewers: ViewerPlaybackGroup[];
  sourceErrors: SourcePlaybackError[];
}
