import { createClient } from "@cliparr/plex/pms/client";
import { transcodeDecision } from "@cliparr/plex/pms";
import type { TranscodeDecisionData } from "@cliparr/plex/pms/types";
import type { MediaHandle } from "@/providers/types";
import { fetchMediaHandleRequest } from "@/providers/shared/mediaProxy";
import { createApiError } from "@/http/errors";
import {
  CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
  PLEX_CLIENT_IDENTIFIER,
} from "@/providers/plex/shared";

export async function requestSubtitleDecision(
  handle: MediaHandle,
  query: TranscodeDecisionData["query"],
  headers: Headers,
  signal: AbortSignal,
) {
  const client = createClient({
    baseUrl: handle.baseUrl,
    headers,
    signal,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      if (url.origin !== new URL(handle.baseUrl).origin) {
        throw new Error("Generated media request changed origin");
      }
      return fetchMediaHandleRequest(
        { ...handle, path: `${url.pathname}${url.search}` },
        {
          headers: request.headers,
          signal,
          timeoutMs: CURRENT_PLAYBACK_REQUEST_TIMEOUT_MS,
          retryAttempts: 1,
        },
      );
    },
  });
  const result = await transcodeDecision({
    client,
    path: { transcodeType: "video" },
    query,
    headers: { "X-Plex-Client-Identifier": PLEX_CLIENT_IDENTIFIER },
  });
  signal.throwIfAborted();
  if (result.data === undefined) {
    throw createApiError(
      result.response && !result.response.ok ? result.response.status : 502,
      "plex_subtitle_decision_failed",
      "Plex could not prepare the embedded subtitle track.",
    );
  }
  return result.data;
}
