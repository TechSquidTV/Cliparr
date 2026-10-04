import type { DiscardedTrack, MetadataTags } from "mediabunny";
import { logErrorFields, logEventFields } from "@cliparr/shared/logging";
import type { MediaExportMetadata } from "#/providers/types";
import { describeInputTrack } from "#/lib/mediabunnyTrackAccess";
import type { ExportFormat } from "#/lib/exportTypes";
import { buildKeyValueExternalIdTags } from "#/lib/metadata/externalIdTags";
import { getFrontendLogger, warnWithError } from "#/logging";

const logger = getFrontendLogger(["editor", "artwork"]);
const byteMask = 255;

const discardReasonLabels: Record<DiscardedTrack["reason"], string> = {
  discarded_by_user: "discarded by configuration",
  max_track_count_reached: "the output track limit was reached",
  max_track_count_of_type_reached:
    "the output cannot contain another track of this type",
  unknown_source_codec: "the source codec is unknown",
  undecodable_source_codec: "the source codec could not be decoded",
  no_encodable_target_codec: "no compatible output codec could be encoded",
  cannot_copy: "the track cannot be copied without re-encoding",
};

export async function describeDiscardedTracks(
  discardedTracks: readonly DiscardedTrack[],
) {
  if (discardedTracks.length === 0) {
    return "";
  }

  const details = await Promise.all(
    discardedTracks.map(
      async ({ track, reason }) =>
        `${await describeInputTrack(track)}: ${discardReasonLabels[reason]}`,
    ),
  );

  return details.join("; ");
}

function firstText(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return;
}

function nonNegativeInteger(value: number | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function parseMetadataDate(date: string | undefined, year: number | undefined) {
  const dateText = firstText(date, year ? `${year}-01-01` : undefined);
  if (!dateText) {
    return;
  }

  const parsed = new Date(dateText);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function formatMetadataTimecode(wholeMilliseconds: number) {
  if (!Number.isFinite(wholeMilliseconds)) {
    return "00:00:00.000";
  }

  const milliseconds = wholeMilliseconds % 1000;
  const wholeSeconds = Math.floor(wholeMilliseconds / 1000);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  return `${[
    hours.toString().padStart(2, "0"),
    minutes.toString().padStart(2, "0"),
    remainingSeconds.toString().padStart(2, "0"),
  ].join(":")}.${milliseconds.toString().padStart(3, "0")}`;
}

function uint8Atom(value: number) {
  return new Uint8Array([Math.max(0, Math.min(255, value))]);
}

function uint32Atom(value: number) {
  const safeValue = Math.max(0, Math.trunc(value));
  return new Uint8Array([
    (safeValue >>> 24) & byteMask,
    (safeValue >>> 16) & byteMask,
    (safeValue >>> 8) & byteMask,
    safeValue & byteMask,
  ]);
}

const mp4IntegerMetadataDataTypes: Record<string, number> = {
  hdvd: 0x15,
  stik: 0x15,
  tves: 0x15,
  tvsn: 0x16,
};

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 2 ** 24 +
    bytes[offset + 1] * 2 ** 16 +
    bytes[offset + 2] * 2 ** 8 +
    bytes[offset + 3]
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & byteMask;
  bytes[offset + 1] = (value >>> 16) & byteMask;
  bytes[offset + 2] = (value >>> 8) & byteMask;
  bytes[offset + 3] = value & byteMask;
}

function readBoxType(bytes: Uint8Array, offset: number) {
  return String.fromCodePoint(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function boxBounds(bytes: Uint8Array, offset: number, end: number) {
  const size32 = readUint32(bytes, offset);
  const headerSize = size32 === 1 ? 16 : 8;
  let size = size32;

  if (size32 === 0) {
    size = end - offset;
  } else if (size32 === 1) {
    if (offset + 16 > end) {
      return;
    }

    const high = readUint32(bytes, offset + 8);
    const low = readUint32(bytes, offset + 12);
    size = high * 2 ** 32 + low;
  }

  const boxEnd = offset + size;
  if (size < headerSize || boxEnd > end || !Number.isSafeInteger(boxEnd)) {
    return;
  }

  return { headerSize, end: boxEnd };
}

function patchIlstItemDataType(
  bytes: Uint8Array,
  start: number,
  end: number,
  dataType: number,
) {
  let offset = start;

  while (offset + 8 <= end) {
    const bounds = boxBounds(bytes, offset, end);
    if (!bounds) {
      return;
    }

    if (readBoxType(bytes, offset + 4) === "data") {
      if (offset + bounds.headerSize + 4 > bounds.end) {
        return;
      }

      writeUint32(bytes, offset + bounds.headerSize, dataType);
      return;
    }

    offset = bounds.end;
  }
}

export function patchMp4MetadataBoxes(
  bytes: Uint8Array,
  start = 0,
  end = bytes.length,
  parentType?: string,
) {
  let offset = start;

  while (offset + 8 <= end) {
    const bounds = boxBounds(bytes, offset, end);
    if (!bounds) {
      return;
    }

    const type = readBoxType(bytes, offset + 4);
    let contentStart = offset + bounds.headerSize;

    if (parentType === "ilst") {
      const dataType = mp4IntegerMetadataDataTypes[type];
      if (dataType !== undefined) {
        patchIlstItemDataType(bytes, contentStart, bounds.end, dataType);
      }
    }

    if (type === "meta") {
      contentStart += 4;
    }

    if (
      type === "moov" ||
      type === "udta" ||
      type === "meta" ||
      type === "ilst"
    ) {
      patchMp4MetadataBoxes(bytes, contentStart, bounds.end, type);
    }

    offset = bounds.end;
  }
}

function inferHdVideoFlag(height: number | undefined) {
  if (typeof height !== "number" || !Number.isFinite(height)) {
    return;
  }

  if (height >= 720) {
    return 1;
  }
  return 0;
}

function buildMp4RawTags(
  metadata: ExportSourceMetadata,
  outputHeight: number | undefined,
  video: boolean,
): MetadataTags["raw"] | undefined {
  const raw: MetadataTags["raw"] = {};
  const itemType = metadata.itemType?.toLowerCase();
  const showTitle = firstText(metadata.showTitle);
  const seasonNumber = nonNegativeInteger(metadata.seasonNumber);
  const episodeNumber = nonNegativeInteger(metadata.episodeNumber);
  const network = firstText(metadata.network, metadata.studio);
  const director = firstText(metadata.directors?.join(", "));
  const longDescription = firstText(metadata.description, metadata.tagline);

  if (longDescription) {
    raw.ldes = longDescription;
  }

  if (director) {
    raw["©dir"] = director;
  }

  const hdVideoFlag = inferHdVideoFlag(outputHeight);
  if (hdVideoFlag !== undefined) {
    raw.hdvd = uint8Atom(hdVideoFlag);
  }

  if (itemType === "episode") {
    if (video) {
      raw.stik = uint8Atom(10);
    }

    if (showTitle) {
      raw.tvsh = showTitle;
    }
    if (seasonNumber !== undefined) {
      raw.tvsn = uint32Atom(seasonNumber);
    }
    if (episodeNumber !== undefined) {
      raw.tves = uint32Atom(episodeNumber);
    }
    if (seasonNumber !== undefined && episodeNumber !== undefined) {
      raw.tven = `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
    }
    if (network) {
      raw.tvnn = network;
    }
  } else if (video && itemType === "movie") {
    raw.stik = uint8Atom(9);
  }

  return Object.keys(raw).length > 0 ? raw : undefined;
}

export function isIsobmffExportFormat(format: ExportFormat) {
  return format === "mp4" || format === "mov" || format === "m4a";
}

function inferImageMimeType(url: string) {
  const pathname = new URL(
    url,
    globalThis.window.location.href,
  ).pathname.toLowerCase();
  if (pathname.endsWith(".png")) {
    return "image/png";
  }
  if (pathname.endsWith(".webp")) {
    return "image/webp";
  }
  if (pathname.endsWith(".gif")) {
    return "image/gif";
  }
  if (pathname.endsWith(".bmp")) {
    return "image/bmp";
  }
  return "image/jpeg";
}

async function fetchAttachedImage(
  url: string | undefined,
  signal?: AbortSignal,
): Promise<NonNullable<MetadataTags["images"]>[number] | undefined> {
  if (!url) {
    return undefined;
  }

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      logger.warn("Could not fetch clip artwork.", {
        ...logEventFields("editor.artwork.load", "failure"),
        "http.status_code": response.status,
      });
      return undefined;
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    let mimeType = contentType?.startsWith("image/")
      ? contentType
      : inferImageMimeType(url);
    let data = new Uint8Array(await response.arrayBuffer());
    signal?.throwIfAborted();
    if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
      const bitmap = await createImageBitmap(
        new Blob([data], { type: mimeType }),
      );
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Could not normalize artwork.");
        }
        context.drawImage(bitmap, 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        data = new Uint8Array(await blob.arrayBuffer());
        mimeType = "image/png";
      } finally {
        bitmap.close();
      }
      signal?.throwIfAborted();
    }

    if (data.length === 0) {
      return undefined;
    }

    return {
      data,
      mimeType,
      kind: "coverFront",
    };
  } catch (error) {
    signal?.throwIfAborted();
    warnWithError(logger, error, "Could not embed clip artwork.", {
      ...logEventFields("editor.artwork.load", "failure"),
      ...logErrorFields(error),
    });
    return undefined;
  }
}

type ExportSourceMetadata = Partial<
  Omit<MediaExportMetadata, "providerId" | "ratingKey" | "guids" | "imageUrl">
>;

interface ClipMetadata {
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  durationSeconds: number;
}

function buildSourceClipMetadata(
  metadata: MediaExportMetadata | undefined,
  startTime: number,
  endTime: number,
  title?: string,
) {
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    startTime < 0 ||
    endTime < startTime
  ) {
    throw new Error("Invalid metadata clip interval.");
  }
  // Explicit allowlist prevents future private provider fields from leaking into files.
  const source: ExportSourceMetadata = {};
  const fields = [
    "itemType",
    "title",
    "sourceTitle",
    "showTitle",
    "seasonTitle",
    "seasonNumber",
    "episodeNumber",
    "year",
    "date",
    "description",
    "tagline",
    "studio",
    "network",
    "contentRating",
    "genres",
    "directors",
    "writers",
    "actors",
    "externalIds",
    "criticRating",
    "audienceRating",
  ] as const satisfies readonly (keyof ExportSourceMetadata)[];
  for (const key of fields) {
    const value = metadata?.[key];
    if (value !== undefined) {
      Object.assign(source, { [key]: value });
    }
  }
  source.title = firstText(source.title, source.sourceTitle, title);
  const startMs = Math.round(startTime * 1000);
  const endMs = Math.round(endTime * 1000);
  const clip: ClipMetadata = {
    sourceStartSeconds: startMs / 1000,
    sourceEndSeconds: endMs / 1000,
    durationSeconds: (endMs - startMs) / 1000,
  };
  const startTimecode = formatMetadataTimecode(startMs);
  const endTimecode = formatMetadataTimecode(endMs);
  const identity = firstText(
    source.sourceTitle,
    source.title,
    source.showTitle,
    "source media",
  );
  const comment = `Clip from ${identity}, ${startTimecode} to ${endTimecode}.${source.contentRating ? ` Content rating: ${source.contentRating}.` : ""}`;
  const timing = {
    CLIPARR_SOURCE_START_SECONDS: clip.sourceStartSeconds.toFixed(3),
    CLIPARR_SOURCE_END_SECONDS: clip.sourceEndSeconds.toFixed(3),
    CLIPARR_CLIP_DURATION_SECONDS: clip.durationSeconds.toFixed(3),
    CLIPARR_SOURCE_START_TIMECODE: startTimecode,
  };
  return {
    source,
    comment,
    timing,
    payload: JSON.stringify({ version: 1, source, clip }),
  };
}

export async function buildMetadataTags(
  metadata: MediaExportMetadata | undefined,
  startTime: number,
  endTime: number,
  outputHeight: number | undefined,
  format: ExportFormat,
  options: { signal?: AbortSignal; title?: string } = {},
): Promise<MetadataTags | undefined> {
  if (format === "gif") {
    return undefined;
  }
  const { source, comment, timing, payload } = buildSourceClipMetadata(
    metadata,
    startTime,
    endTime,
    options.title,
  );
  const tags: MetadataTags = {
    title: source.title,
    // The episode's show title rides the artist slot (©ART/ARTIST/TPE1/IART)
    // so players group clips under their series. This is a Cliparr
    // convention, not an authorship claim.
    artist:
      source.itemType?.toLowerCase() === "episode"
        ? firstText(source.showTitle)
        : undefined,
    description: firstText(source.description, source.tagline),
    genre: source.genres?.join(", "),
    date: parseMetadataDate(source.date, source.year),
    comment,
  };
  const image = await fetchAttachedImage(metadata?.imageUrl, options.signal);
  if (image) {
    tags.images = [image];
  }
  // Ratings stay in the clpr/CLIPARR_METADATA JSON payload only.
  // MP4 `rtng` is a clean/explicit advisory flag, never a score, so it is
  // deliberately not used for critic or audience ratings.
  const externalIds = source.externalIds;
  if (isIsobmffExportFormat(format)) {
    // Mediabunny cannot write freeform `----` atoms (4-char raw keys only),
    // so MP4/MOV/M4A carry external IDs in the clpr payload alone.
    tags.raw = {
      ...buildMp4RawTags(source, outputHeight, format !== "m4a"),
      csta: timing.CLIPARR_SOURCE_START_SECONDS,
      cend: timing.CLIPARR_SOURCE_END_SECONDS,
      cdur: timing.CLIPARR_CLIP_DURATION_SECONDS,
      "©TIM": timing.CLIPARR_SOURCE_START_TIMECODE,
      clpr: payload,
    };
  } else if (format === "mp3" || format === "wav") {
    // The export pipeline explicitly uses ID3 for WAV to retain Unicode and artwork.
    // WAV external IDs stay in JSON; MP3 additionally exposes TXXX ID descriptions.
    tags.raw = {
      TXXX: {
        ...timing,
        ...(format === "mp3" ? buildKeyValueExternalIdTags(externalIds) : {}),
        CLIPARR_METADATA: payload,
      },
    };
  } else {
    // MKV/WebM SimpleTags and OGG/FLAC Vorbis comments accept arbitrary
    // key names, so external IDs ride as native IMDB/TMDB/TVDB tags.
    tags.raw = {
      ...timing,
      ...buildKeyValueExternalIdTags(externalIds),
      CLIPARR_METADATA: payload,
    };
  }
  options.signal?.throwIfAborted();
  return tags;
}
