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
  connections: ProviderConnection[];
}

export interface ProviderSession {
  id: string;
  providerId: string;
  selectedResource?: ProviderResource;
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
  exportMetadata?: MediaExportMetadata;
}
