export interface ProviderDefinition {
  id: string;
  name: string;
  auth: "pin";
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

export interface MediaExportMetadata {
  providerId: string;
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

export interface PlaybackViewer {
  id: string;
  providerId: string;
  externalId?: string;
  name: string;
  avatarUrl?: string;
}

export interface PlaybackSource {
  id: string;
  name: string;
  providerId: string;
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
  exportMetadata?: MediaExportMetadata;
}

export interface ViewerPlaybackGroup {
  viewer: PlaybackViewer;
  items: CurrentlyPlayingItem[];
}

export interface SourcePlaybackError {
  sourceId: string;
  sourceName: string;
  providerId: string;
  message: string;
}

export interface CurrentlyPlayingResponse {
  viewers: ViewerPlaybackGroup[];
  sourceErrors: SourcePlaybackError[];
}
