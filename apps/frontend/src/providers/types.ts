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
