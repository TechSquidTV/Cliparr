import type { DiscardedTrack, MetadataTags } from "mediabunny";
import { logErrorFields, logEventFields } from "@cliparr/shared/logging";
import type { MediaExportMetadata } from "@/providers/types";
import { describeInputTrack } from "@/lib/mediabunnyTrackAccess";
import type { ExportFormat } from "@/lib/exportTypes";
import { getFrontendLogger, warnWithError } from "@/logging";

const logger = getFrontendLogger(["editor", "artwork"]);

const discardReasonLabels: Record<DiscardedTrack["reason"], string> = {
  discarded_by_user: "discarded by configuration",
  max_track_count_reached: "the output track limit was reached",
  max_track_count_of_type_reached:
    "the output cannot contain another track of this type",
  unknown_source_codec: "the source codec is unknown",
  undecodable_source_codec: "the source codec could not be decoded",
  no_encodable_target_codec: "no compatible output codec could be encoded",
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

  return undefined;
}

function nonNegativeInteger(value: number | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function parseMetadataDate(date: string | undefined, year: number | undefined) {
  const dateText = firstText(date, year ? `${year}-01-01` : undefined);
  if (!dateText) {
    return undefined;
  }

  const parsed = new Date(dateText);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function formatMetadataTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return "0:00";
  }

  const wholeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatMetadataTimecode(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return "00:00:00.000";
  }

  const wholeMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const milliseconds = wholeMilliseconds % 1000;
  const wholeSeconds = Math.floor(wholeMilliseconds / 1000);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  return (
    [
      hours.toString().padStart(2, "0"),
      minutes.toString().padStart(2, "0"),
      remainingSeconds.toString().padStart(2, "0"),
    ].join(":") + `.${milliseconds.toString().padStart(3, "0")}`
  );
}

function formatMetadataSeconds(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return "0.000";
  }

  return Math.max(0, seconds).toFixed(3);
}

function uint8Atom(value: number) {
  return new Uint8Array([Math.max(0, Math.min(255, value))]);
}

function uint32Atom(value: number) {
  const safeValue = Math.max(0, Math.trunc(value));
  return new Uint8Array([
    (safeValue >>> 24) & 0xff,
    (safeValue >>> 16) & 0xff,
    (safeValue >>> 8) & 0xff,
    safeValue & 0xff,
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
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function readBoxType(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
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
      return undefined;
    }

    const high = readUint32(bytes, offset + 8);
    const low = readUint32(bytes, offset + 12);
    size = high * 2 ** 32 + low;
  }

  const boxEnd = offset + size;
  if (size < headerSize || boxEnd > end || !Number.isSafeInteger(boxEnd)) {
    return undefined;
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
    return undefined;
  }

  if (height >= 720) return 1;
  return 0;
}

function buildMp4RawTags(
  metadata: MediaExportMetadata,
  outputHeight: number | undefined,
  startTime: number,
  endTime: number,
): MetadataTags["raw"] | undefined {
  const raw: MetadataTags["raw"] = {};
  const itemType = metadata.itemType.toLowerCase();
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

  raw["©TIM"] = formatMetadataTimecode(startTime);
  raw.csta = formatMetadataSeconds(startTime);
  raw.cend = formatMetadataSeconds(endTime);
  raw.cdur = formatMetadataSeconds(endTime - startTime);
  raw.clpr = JSON.stringify({
    sourceStartSeconds: Number(formatMetadataSeconds(startTime)),
    sourceEndSeconds: Number(formatMetadataSeconds(endTime)),
    sourceDurationSeconds: Number(formatMetadataSeconds(endTime - startTime)),
  });

  if (itemType === "episode") {
    raw.stik = uint8Atom(10);

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
  } else if (itemType === "movie") {
    raw.stik = uint8Atom(9);
  }

  return Object.keys(raw).length > 0 ? raw : undefined;
}

export function isIsobmffExportFormat(format: ExportFormat) {
  return format === "mp4" || format === "mov";
}

function inferImageMimeType(url: string) {
  const pathname = new URL(url, window.location.href).pathname.toLowerCase();
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".bmp")) return "image/bmp";
  return "image/jpeg";
}

async function fetchAttachedImage(
  url: string | undefined,
): Promise<NonNullable<MetadataTags["images"]>[number] | undefined> {
  if (!url) {
    return undefined;
  }

  try {
    const response = await fetch(url);
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
    const mimeType = contentType?.startsWith("image/")
      ? contentType
      : inferImageMimeType(url);
    const data = new Uint8Array(await response.arrayBuffer());

    if (data.length === 0) {
      return undefined;
    }

    return {
      data,
      mimeType,
      kind: "coverFront",
    };
  } catch (err) {
    warnWithError(logger, err, "Could not embed clip artwork.", {
      ...logEventFields("editor.artwork.load", "failure"),
      ...logErrorFields(err),
    });
    return undefined;
  }
}

export async function buildMetadataTags(
  metadata: MediaExportMetadata | undefined,
  startTime: number,
  endTime: number,
  outputHeight: number | undefined,
  format: ExportFormat,
): Promise<MetadataTags | undefined> {
  if (!metadata) {
    return undefined;
  }

  const title = firstText(metadata.title, metadata.sourceTitle);
  const description = firstText(metadata.description, metadata.tagline);
  const sourceTitle = firstText(metadata.showTitle);
  const clipRange = `${formatMetadataTime(startTime)} to ${formatMetadataTime(endTime)}`;
  const tags: MetadataTags = {};

  if (title) tags.title = title;
  if (description) tags.description = description;
  if (metadata.genres?.length) tags.genre = metadata.genres.join(", ");

  const date = parseMetadataDate(metadata.date, metadata.year);
  if (date) tags.date = date;

  const source = firstText(
    metadata.sourceTitle,
    metadata.title,
    sourceTitle,
    "source media",
  );
  const contentRating = firstText(metadata.contentRating);
  tags.comment = `Clip from ${source}, ${clipRange}.${contentRating ? ` Content rating: ${contentRating}.` : ""}`;

  const image = await fetchAttachedImage(metadata.imageUrl);
  if (image) {
    tags.images = [image];
  }

  const raw = isIsobmffExportFormat(format)
    ? buildMp4RawTags(metadata, outputHeight, startTime, endTime)
    : undefined;
  if (raw) {
    tags.raw = raw;
  }

  return Object.keys(tags).length > 0 ? tags : undefined;
}
