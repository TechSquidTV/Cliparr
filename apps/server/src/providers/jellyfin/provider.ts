import {
  authenticateWithCredentials,
  checkSource,
} from "@/providers/jellyfin/auth";
import { watchCurrentlyPlaying } from "@/providers/jellyfin/live";
import { proxyMedia } from "@/providers/jellyfin/mediaProxy";
import {
  listCurrentlyPlaying,
  sourceSupportsCurrentlyPlaying,
} from "@/providers/jellyfin/playback";
import type { ProviderImplementation } from "@/providers/types";

export const jellyfinProvider: ProviderImplementation = {
  definition: {
    id: "jellyfin",
    name: "Jellyfin",
    auth: "credentials",
  },
  authenticateWithCredentials,
  supportsCurrentlyPlayingSource: sourceSupportsCurrentlyPlaying,
  checkSource,
  watchCurrentlyPlaying,
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
