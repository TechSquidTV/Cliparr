import { parseExternalIds } from "@cliparr/shared/external-ids";
import type { MediaExportMetadata } from "@cliparr/shared/providers";

import { buildEpisodeSourceTitle } from "@/providers/shared/utilities";

type NormalizedMetadataFields = Omit<
  MediaExportMetadata,
  "sourceTitle" | "externalIds"
> & { isEpisode: boolean };

export function buildMediaExportMetadata({
  isEpisode,
  ...fields
}: NormalizedMetadataFields): MediaExportMetadata {
  return {
    ...fields,
    sourceTitle: isEpisode
      ? (buildEpisodeSourceTitle({
          title: fields.title,
          seriesTitle: fields.showTitle,
          seasonNumber: fields.seasonNumber,
          episodeNumber: fields.episodeNumber,
        }) ?? fields.title)
      : fields.title,
    actors: fields.actors?.slice(0, 12),
    externalIds: parseExternalIds(fields.guids ?? []),
  };
}
