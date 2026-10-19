import { isApiError } from "@/http/errors";
import { pollAuth, startAuth } from "@/providers/plex/auth";
import {
  PLEX_BASE_URL_MODE_AUTO,
  withPlexBaseUrlMode,
} from "@/providers/plex/connectionState";
import { watchCurrentlyPlaying } from "@/providers/plex/live";
import { proxyMedia } from "@/providers/plex/mediaProxy";
import { listCurrentlyPlaying } from "@/providers/plex/playback";
import {
  selectReachableConnection,
  sourceResource,
  sourceSupportsCurrentlyPlaying,
} from "@/providers/plex/shared";
import { defineProvider } from "@/providers/shared/defineProvider";
import type { ProviderImplementation } from "@/providers/types";

async function checkSource(
  source: Parameters<ProviderImplementation["checkSource"]>[0],
) {
  const {
    baseUrlMode,
    manualConnectionId,
    persistedConnections,
    preferredConnectionId,
    resource,
  } = sourceResource(source);
  try {
    const selectedConnection = await selectReachableConnection(
      resource,
      preferredConnectionId,
      {
        baseUrlMode,
      },
    );

    return {
      ok: true as const,
      ...(baseUrlMode === PLEX_BASE_URL_MODE_AUTO
        ? { baseUrl: selectedConnection.uri }
        : {}),
      connection: {
        ...withPlexBaseUrlMode(source.connection, baseUrlMode),
        connections: persistedConnections,
        selectedConnectionId:
          selectedConnection.id === manualConnectionId
            ? source.connection.selectedConnectionId
            : selectedConnection.id,
      },
    };
  } catch (error) {
    if (isApiError(error) && error.code === "plex_unreachable") {
      return {
        ok: false as const,
        message: error.message,
      };
    }

    throw error;
  }
}

export const plexProvider = defineProvider({
  definition: {
    id: "plex",
    name: "Plex",
    auth: "pin",
  },
  startAuth,
  pollAuth,
  supportsCurrentlyPlayingSource: sourceSupportsCurrentlyPlaying,
  checkSource,
  listCurrentlyPlaying,
  watchCurrentlyPlaying,
  proxyMedia,
});
