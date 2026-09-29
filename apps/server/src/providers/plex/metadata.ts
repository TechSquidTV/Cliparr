import { logErrorFields, sanitizeUrlForLog } from "@cliparr/shared/logging";
import { getServerLogger } from "@/logging";
import type { ProviderSessionRecord } from "@/session/store";
import type { Tag } from "@cliparr/plex/pms/types";
import { imageTranscodeUrl } from "@cliparr/plex/pms/urls";
import type { MediaExportMetadata } from "@/providers/types";
import {
  asArray,
  buildEpisodeSourceTitle,
  numberValue,
  stringValue,
  uniqueStrings,
} from "@/providers/shared/utilities";
import {
  fetchPmsMetadata,
  type PlexSourceContext,
} from "@/providers/plex/shared";
import type { PlexMetadataItem } from "@/providers/plex/selection";
import {
  itemTypeValue,
  mergePlaybackMetadata,
  metadataId,
} from "@/providers/plex/selection";
import { createMediaHandle } from "@/providers/plex/mediaHandles";

const logger = getServerLogger(["provider", "plex", "playback"]);

const HD_ARTWORK_SIZE = 1920;

function tagValues(value: Tag[] | undefined) {
  return uniqueStrings(
    asArray(value).map((entry) => {
      if (typeof entry === "string") {
        return stringValue(entry);
      }

      return (
        stringValue(entry?.tag) ??
        stringValue(entry?.id) ??
        stringValue(entry?.ratingKey)
      );
    }),
  );
}

export function metadataImagePath(item: PlexMetadataItem) {
  const type = itemTypeValue(item);
  if (type === "episode") {
    return (
      stringValue(item.grandparentThumb) ??
      stringValue(item.parentThumb) ??
      stringValue(item.thumb)
    );
  }

  if (type === "track") {
    return (
      stringValue(item?.thumb) ??
      stringValue(item?.parentThumb) ??
      stringValue(item?.grandparentThumb)
    );
  }

  return (
    stringValue(item?.thumb) ??
    stringValue(item?.grandparentThumb) ??
    stringValue(item?.parentThumb)
  );
}

function authenticatedImagePath(path: string, context: PlexSourceContext) {
  const base = new URL(context.baseUrl);
  const image = new URL(path, base);
  if (image.origin !== base.origin) {
    return path;
  }
  image.searchParams.set("X-Plex-Token", context.token);
  return path.startsWith("/") && !path.startsWith("//")
    ? `${image.pathname}${image.search}${image.hash}`
    : image.toString();
}

function metadataHdImagePath(
  item: PlexMetadataItem,
  context: PlexSourceContext,
) {
  const imagePath = metadataImagePath(item);
  if (!imagePath) {
    return;
  }

  return imageTranscodeUrl({
    query: {
      url: authenticatedImagePath(imagePath, context),
      width: HD_ARTWORK_SIZE,
      height: HD_ARTWORK_SIZE,
      quality: -1,
      upscale: 0,
    },
  });
}

function buildSourceTitle(item: PlexMetadataItem) {
  const title = stringValue(item?.title);
  if (itemTypeValue(item) !== "episode") {
    return title;
  }

  return (
    buildEpisodeSourceTitle({
      title,
      seriesTitle: stringValue(item.grandparentTitle),
      seasonNumber: numberValue(item.parentIndex),
      episodeNumber: numberValue(item.index),
    }) ?? title
  );
}

export async function enrichPlaybackItems(
  context: PlexSourceContext,
  items: PlexMetadataItem[],
) {
  const ids = uniqueStrings(items.map((item) => metadataId(item)));
  if (ids.length === 0) {
    return items;
  }
  try {
    const data = await fetchPmsMetadata(context, ids);
    const byId = new Map(
      (data.MediaContainer?.Metadata ?? []).map((item) => [
        metadataId(item),
        item,
      ]),
    );
    return items.map((item) => {
      const id = metadataId(item);
      return mergePlaybackMetadata(item, id ? byId.get(id) : undefined);
    });
  } catch (error) {
    logger.warn("Could not fetch Plex metadata.", {
      ...logErrorFields(error),
      "metadata.count": ids.length,
      "source.id": context.sourceId,
      "source.base_url": sanitizeUrlForLog(context.baseUrl),
    });
    return items;
  }
}

export function createExportMetadata(
  session: ProviderSessionRecord,
  context: PlexSourceContext,
  item: PlexMetadataItem,
): MediaExportMetadata {
  const imagePath = metadataHdImagePath(item, context);
  const guid = stringValue(item?.guid);

  return {
    providerId: "plex",
    itemType: stringValue(item?.type) ?? "video",
    title: stringValue(item?.title),
    sourceTitle: buildSourceTitle(item),
    showTitle: stringValue(item?.grandparentTitle),
    seasonTitle: stringValue(item?.parentTitle),
    seasonNumber: numberValue(item?.parentIndex),
    episodeNumber: numberValue(item?.index),
    year: numberValue(item?.year),
    date: stringValue(item?.originallyAvailableAt),
    description: stringValue(item?.summary),
    tagline: stringValue(item?.tagline),
    studio: stringValue(item?.studio),

    contentRating: stringValue(item?.contentRating),
    genres: tagValues(item?.Genre),
    directors: tagValues(item?.Director),
    writers: tagValues(item?.Writer),
    actors: tagValues(item?.Role).slice(0, 12),
    guids: uniqueStrings([guid, ...tagValues(item?.Guid)]),
    ratingKey: stringValue(item?.ratingKey),
    imageUrl: imagePath
      ? createMediaHandle(session, context, imagePath, {
          generatedOperation: true,
        })
      : undefined,
  };
}
