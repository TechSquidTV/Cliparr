import type { ProviderImplementation } from "@/providers/types";
import { watchCurrentlyPlaying } from "@/providers/jellyfin/live";
import {
  authenticateWithCredentials,
  checkSource,
} from "@/providers/jellyfin/auth";
import {
  listCurrentlyPlaying,
  sourceSupportsCurrentlyPlaying,
} from "@/providers/jellyfin/playback";
import { proxyMedia } from "@/providers/jellyfin/mediaProxy";

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
