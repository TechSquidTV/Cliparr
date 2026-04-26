import { ApiError } from "../../http/errors.js";
import type { ProviderImplementation } from "../types.js";
import { pollAuth, startAuth } from "./auth.js";
import {
  PLEX_BASE_URL_MODE_AUTO,
  withPlexBaseUrlMode,
} from "./connectionState.js";
import { listCurrentlyPlaying, proxyMedia } from "./playback.js";
import { selectReachableConnection, sourceResource, sourceSupportsCurrentlyPlaying } from "./shared.js";

async function checkSource(source: Parameters<ProviderImplementation["checkSource"]>[0]) {
  const {
    baseUrlMode,
    manualConnectionId,
    persistedConnections,
    preferredConnectionId,
    resource,
  } = sourceResource(source);
  try {
    const selectedConnection = await selectReachableConnection(resource, preferredConnectionId, {
      baseUrlMode,
    });

    return {
      ok: true as const,
      ...(baseUrlMode === PLEX_BASE_URL_MODE_AUTO ? { baseUrl: selectedConnection.uri } : {}),
      connection: {
        ...withPlexBaseUrlMode(
          source.connection,
          baseUrlMode
        ),
        connections: persistedConnections,
        selectedConnectionId: selectedConnection.id === manualConnectionId
          ? source.connection.selectedConnectionId
          : selectedConnection.id,
      },
    };
  } catch (err) {
    if (err instanceof ApiError && err.code === "plex_unreachable") {
      return {
        ok: false as const,
        message: err.message,
      };
    }

    throw err;
  }
}

export const plexProvider: ProviderImplementation = {
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
  proxyMedia,
  serializeSession(session) {
    return {
      id: session.id,
      providerId: "plex",
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  },
};
