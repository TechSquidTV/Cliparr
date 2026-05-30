import type { ProviderImplementation } from "#/providers/types.js";
import {
  authenticateWithCredentials,
  checkSource,
} from "#/providers/jellyfin/auth.js";
import {
  listCurrentlyPlaying,
  proxyMedia,
  sourceSupportsCurrentlyPlaying,
} from "#/providers/jellyfin/playback.js";

export const jellyfinProvider: ProviderImplementation = {
  definition: {
    id: "jellyfin",
    name: "Jellyfin",
    auth: "credentials",
  },
  authenticateWithCredentials,
  supportsCurrentlyPlayingSource: sourceSupportsCurrentlyPlaying,
  checkSource,
  listCurrentlyPlaying,
  proxyMedia,
  serializeSession(session) {
    return {
      id: session.id,
      providerId: "jellyfin",
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  },
};
