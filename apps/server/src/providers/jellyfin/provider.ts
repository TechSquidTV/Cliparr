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
import { defineProvider } from "@/providers/shared/defineProvider";

export const jellyfinProvider = defineProvider({
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
});
