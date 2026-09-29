import type { ProviderSessionRecord } from "@/session/store";
import type { TranscodeDecisionData } from "@cliparr/plex/pms/types";
import { createProviderMediaHandle } from "@/providers/shared/mediaProxy";
import { type PlexSourceContext } from "@/providers/plex/shared";

export function createMediaHandle(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  path: string,
  options: {
    generatedOperation?: boolean;
    basePath?: string;
    playbackSessionId?: string;
    subtitleStreamId?: string;
    subtitleDecision?: TranscodeDecisionData["query"];
  } = {},
) {
  return createProviderMediaHandle(
    session,
    {
      providerId: "plex",
      sourceId: context.sourceId,
      baseUrl: context.baseUrl,
      token: context.token,
      providerMetadata:
        options.playbackSessionId === undefined
          ? undefined
          : {
              plex: {
                playbackSessionId: options.playbackSessionId,
                subtitleStreamId: options.subtitleStreamId,
                subtitleDecision: options.subtitleDecision,
              },
            },
    },
    // Generated endpoints are relative to the configured PMS API base. Returned
    // resources instead retain their own URL resolution semantics.
    options.generatedOperation
      ? `${context.baseUrl.replace(/\/+$/, "")}${path}`
      : path,
    {
      basePath: options.basePath,
    },
  );
}
