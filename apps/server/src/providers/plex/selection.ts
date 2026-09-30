import { createHash } from "node:crypto";
import { normalizeExportVideoCodec } from "@cliparr/shared/providers";
import type {
  Media,
  Part,
  StatusGetSlashResponse,
  Stream,
} from "@cliparr/plex/pms/types";
import {
  libraryMetadataGetSlashUrl,
  transcodeStartUrl,
} from "@cliparr/plex/pms/urls";
import type {
  PlaybackAudioSelection,
  PlaybackExportEstimateMetadata,
} from "@/providers/types";
import { booleanFlag } from "@/providers/shared/subtitles";
import {
  asArray,
  numberValue,
  stringValue,
} from "@/providers/shared/utilities";

const PLEX_METADATA_PATH_PREFIX = "/library/metadata/";

export type PlexMetadataItem = NonNullable<
  NonNullable<StatusGetSlashResponse["MediaContainer"]>["Metadata"]
>[number];

export type PlexStream = Stream;

export type PlexPart = Part;

type PlexMedia = Media;

type PlexMetadataPathItem = Pick<PlexMetadataItem, "ratingKey" | "key">;

type PlexSelectableEntry = Pick<Stream, "selected">;

type PlexViewOffsetValue = PlexMetadataItem["viewOffset"];

export function metadataPath(item: PlexMetadataPathItem | null | undefined) {
  const ratingKey = idValue(item?.ratingKey);
  if (ratingKey) {
    return libraryMetadataGetSlashUrl({ path: { ids: [ratingKey] } });
  }
  if (
    typeof item?.key === "string" &&
    item.key.startsWith(PLEX_METADATA_PATH_PREFIX)
  ) {
    return item.key;
  }
  return;
}

export function metadataId(item: PlexMetadataPathItem | null | undefined) {
  const ratingKey = idValue(item?.ratingKey);
  if (ratingKey) {
    return ratingKey;
  }

  const path = metadataPath(item);
  if (!path) {
    return;
  }

  const parsed = new URL(path, "http://cliparr.local");
  const id = parsed.pathname
    .slice(PLEX_METADATA_PATH_PREFIX.length)
    .split("/")[0];
  return idValue(id);
}

export interface PlexMediaSelection {
  mediaId?: string;
  mediaIndex?: number;
  partId?: string;
  partIndex?: number;
}

export function idValue(value: string | number | undefined) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return;
}

export function itemTypeValue(item: PlexMetadataItem) {
  return stringValue(item.type)?.toLowerCase() ?? "";
}

export function itemTitleValue(item: PlexMetadataItem) {
  return stringValue(item.title) ?? "Untitled";
}

export function isSelectedEntry(entry: PlexSelectableEntry | undefined) {
  return booleanFlag(entry?.selected) === true;
}

function mediaEntries(item: PlexMetadataItem | undefined) {
  return asArray(item?.Media);
}

function partEntries(media: PlexMedia | undefined) {
  return asArray(media?.Part);
}

export function streamEntries(part: PlexPart | undefined) {
  return asArray(part?.Stream);
}

function selectedIndex<T extends PlexSelectableEntry>(entries: T[]) {
  const index = entries.findIndex((entry) => isSelectedEntry(entry));
  return Math.max(index, 0);
}

function correspondingIndex<T extends { id?: string | number }>(
  entries: T[],
  id: string | undefined,
  index: number | undefined,
) {
  if (id !== undefined) {
    const match = entries.findIndex((entry) => idValue(entry.id) === id);
    if (match !== -1) {
      return match;
    }
  }
  // Position is meaningful only when at least one side has no identity.
  if (
    index !== undefined &&
    entries[index] &&
    (id === undefined || idValue(entries[index].id) === undefined)
  ) {
    return index;
  }
  return -1;
}

function correspondingEntry<T extends { id?: string | number }>(
  entries: T[] = [],
  entry: T,
  index: number,
) {
  return entries[correspondingIndex(entries, idValue(entry.id), index)];
}

function correspondingStream(
  entries: PlexStream[],
  stream: PlexStream,
  index?: number,
) {
  const id = idValue(stream.id);
  const compatible = (candidate: PlexStream) =>
    (candidate.streamType === undefined ||
      stream.streamType === undefined ||
      candidate.streamType === stream.streamType) &&
    (id === undefined ||
      idValue(candidate.id) === undefined ||
      idValue(candidate.id) === id);
  const identified =
    id === undefined
      ? undefined
      : entries.find(
          (candidate) => idValue(candidate.id) === id && compatible(candidate),
        );
  if (identified) {
    return identified;
  }

  // A session can contain only selected streams. Source indexes/identifiers
  // locate them in the full library list; array positions do not.
  const locators = ["index", "streamIdentifier"] as const;
  const contradicts = (candidate: PlexStream) =>
    locators.some(
      (key) =>
        stream[key] !== undefined &&
        candidate[key] !== undefined &&
        stream[key] !== candidate[key],
    );
  const located = entries.find(
    (candidate) =>
      compatible(candidate) &&
      !contradicts(candidate) &&
      locators.some(
        (key) => stream[key] !== undefined && stream[key] === candidate[key],
      ),
  );
  if (located) {
    return located;
  }
  const positional = index === undefined ? undefined : entries[index];
  return positional && compatible(positional) && !contradicts(positional)
    ? positional
    : undefined;
}

function mergePlaybackStreams(library: PlexStream[], live: PlexStream[]) {
  // Require mutual matches so a positional guess cannot consume a stream that
  // has a stronger identity match elsewhere in the other list.
  const matches = new Map<PlexStream, PlexStream>();
  const unmatched = live.filter((stream, index) => {
    const libraryStream = correspondingStream(library, stream, index);
    if (
      !libraryStream ||
      correspondingStream(
        live,
        libraryStream,
        library.indexOf(libraryStream),
      ) !== stream
    ) {
      return true;
    }
    matches.set(libraryStream, stream);
    return false;
  });
  const streams = library.map((stream) => {
    const liveStream = matches.get(stream);
    const merged = {
      ...liveStream,
      ...stream,
      key: liveStream?.key ?? stream.key,
    };
    // Live selection owns each stream type represented in the session payload.
    return liveStream ||
      live.some((entry) => entry.streamType === stream.streamType)
      ? { ...merged, selected: isSelectedEntry(liveStream) }
      : merged;
  });
  return [...streams, ...unmatched];
}

export function mergePlaybackMetadata(
  live: PlexMetadataItem,
  library: PlexMetadataItem | undefined,
): PlexMetadataItem {
  if (!library) {
    return live;
  }
  return {
    ...live,
    ...library,
    Media:
      library.Media?.map((media, mediaIndex) => {
        const liveMedia = correspondingEntry(live.Media, media, mediaIndex);
        return {
          ...liveMedia,
          ...media,
          selected: liveMedia?.selected ?? media.selected,
          Part:
            media.Part?.map((part, partIndex) => {
              const livePart = correspondingEntry(
                liveMedia?.Part,
                part,
                partIndex,
              );
              return {
                ...livePart,
                ...part,
                key: livePart?.key ?? part.key,
                selected: livePart?.selected ?? part.selected,
                Stream: mergePlaybackStreams(
                  part.Stream ?? [],
                  livePart?.Stream ?? [],
                ),
              };
            }) ?? liveMedia?.Part,
        };
      }) ?? live.Media,
    User: live.User,
    Player: live.Player,
    Session: live.Session,
    sessionKey: live.sessionKey,
    viewOffset: live.viewOffset,
  };
}

export function playheadSecondsFromViewOffset(value?: PlexViewOffsetValue) {
  if (value === null || value === undefined) {
    return;
  }

  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return;
  }

  return milliseconds / 1000;
}

export function deriveMediaSelection(
  item: PlexMetadataItem,
): PlexMediaSelection | undefined {
  const media = mediaEntries(item);
  if (media.length === 0) {
    return undefined;
  }

  const mediaIndex = selectedIndex(media);
  const selectedMedia = media[mediaIndex];
  const parts = partEntries(selectedMedia);
  const partIndex = parts.length > 0 ? selectedIndex(parts) : undefined;
  const selectedPart = partIndex === undefined ? undefined : parts[partIndex];

  return {
    mediaId: idValue(selectedMedia?.id),
    mediaIndex,
    partId: idValue(selectedPart?.id),
    partIndex,
  };
}

export function resolveSelectedPart(
  item: PlexMetadataItem | undefined,
  selection?: PlexMediaSelection,
) {
  const media = mediaEntries(item);
  if (media.length === 0) {
    return;
  }

  const mediaIndex =
    selection?.mediaId !== undefined || selection?.mediaIndex !== undefined
      ? correspondingIndex(media, selection.mediaId, selection.mediaIndex)
      : selectedIndex(media);
  if (mediaIndex < 0) {
    return;
  }

  const selectedMedia = media[mediaIndex];
  const parts = partEntries(selectedMedia);
  if (parts.length === 0) {
    if (selection?.partId !== undefined || selection?.partIndex !== undefined) {
      return;
    }
    return {
      media: selectedMedia,
      mediaIndex,
      part: undefined,
      partIndex: 0,
    };
  }

  const partIndex =
    selection?.partId !== undefined || selection?.partIndex !== undefined
      ? correspondingIndex(parts, selection.partId, selection.partIndex)
      : selectedIndex(parts);
  if (partIndex < 0) {
    return;
  }

  return {
    media: selectedMedia,
    mediaIndex,
    part: parts[partIndex],
    partIndex,
  };
}

export function createPreviewPath(
  item: PlexMetadataItem,
  transcodeSessionId: string,
  selection?: PlexMediaSelection,
) {
  if (itemTypeValue(item) === "track") {
    return;
  }

  const path = metadataPath(item);
  if (!path) {
    return;
  }

  const resolvedSelection = resolveSelectedPart(item, selection);
  if (selection && !resolvedSelection) {
    return;
  }
  return transcodeStartUrl({
    path: { transcodeType: "video", extension: "m3u8" },
    query: {
      path,
      transcodeSessionId,
      protocol: "hls",
      directPlay: 0,
      directStream: 0,
      directStreamAudio: 0,
      subtitles: "none",
      mediaIndex: resolvedSelection?.mediaIndex ?? 0,
      partIndex: resolvedSelection?.partIndex ?? 0,
      audioChannelCount: 2,
      videoQuality: 80,
      videoResolution: "1920x1080",
      videoBitrate: 12_000,
      peakBitrate: 12_000,
      location: "lan",
      mediaBufferSize: 102_400,
    },
  });
}

export function createCliparrPlexTranscodeSessionId(
  sourceId: string,
  plexPlaybackSessionId: string,
) {
  const digest = createHash("sha256")
    .update(`${sourceId}:${plexPlaybackSessionId}`)
    .digest("hex")
    .slice(0, 32);
  const version = "5";
  const variant = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8)
    .toString(16)
    .slice(0, 1);

  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `${version}${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export function isAudioStream(stream: PlexStream) {
  return numberValue(stream?.streamType) === 2;
}

export function isVideoStream(stream: PlexStream) {
  return numberValue(stream?.streamType) === 1;
}

export function isSubtitleStream(stream: PlexStream) {
  return numberValue(stream?.streamType) === 3;
}

function positiveNumber(value: number | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function millisecondsToSeconds(value: number | undefined) {
  const milliseconds = positiveNumber(value);
  return milliseconds === undefined ? undefined : milliseconds / 1000;
}

function firstSelectedOrFirst<T extends PlexSelectableEntry>(
  entries: readonly T[],
) {
  return entries.find((entry) => isSelectedEntry(entry)) ?? entries[0];
}

function bitrateFromSize(
  sourceSizeBytes: number | undefined,
  sourceDurationSeconds: number | undefined,
) {
  return sourceSizeBytes && sourceDurationSeconds
    ? Math.round((sourceSizeBytes * 8) / sourceDurationSeconds / 1000)
    : undefined;
}

export function createPlexExportEstimateMetadata(
  item: PlexMetadataItem,
  selection: PlexMediaSelection | undefined,
  fallbackDurationSeconds: number,
): PlaybackExportEstimateMetadata | undefined {
  const resolvedPart = resolveSelectedPart(item, selection);
  const selectedMedia = resolvedPart?.media;
  const selectedPart = resolvedPart?.part;
  const streams = streamEntries(selectedPart);
  const selectedVideoStream = firstSelectedOrFirst(
    streams.filter((stream) => isVideoStream(stream)),
  );
  const selectedAudioStream = firstSelectedOrFirst(
    streams.filter((stream) => isAudioStream(stream)),
  );
  const sourceSizeBytes = positiveNumber(selectedPart?.size);
  const sourceDurationSeconds =
    millisecondsToSeconds(selectedPart?.duration) ??
    millisecondsToSeconds(selectedMedia?.duration) ??
    (fallbackDurationSeconds > 0 ? fallbackDurationSeconds : undefined);
  const sourceBitrateKbps =
    positiveNumber(selectedMedia?.bitrate) ??
    bitrateFromSize(sourceSizeBytes, sourceDurationSeconds);
  const videoCodec = normalizeExportVideoCodec(
    stringValue(selectedVideoStream?.codec),
  );

  const metadata = {
    sourceSizeBytes,
    sourceDurationSeconds,
    sourceBitrateKbps,
    videoBitrateKbps: positiveNumber(selectedVideoStream?.bitrate),
    audioBitrateKbps: positiveNumber(selectedAudioStream?.bitrate),
    ...(videoCodec ? { videoCodec } : {}),
    width:
      positiveNumber(selectedVideoStream?.width) ??
      positiveNumber(selectedMedia?.width),
    height:
      positiveNumber(selectedVideoStream?.height) ??
      positiveNumber(selectedMedia?.height),
    frameRate: positiveNumber(selectedVideoStream?.frameRate),
  } satisfies PlaybackExportEstimateMetadata;

  return Object.values(metadata).some((value) => value !== undefined)
    ? metadata
    : undefined;
}

export function selectedAudioTrackTitle(stream: PlexStream) {
  return (
    stringValue(stream?.title) ??
    stringValue(stream?.extendedDisplayTitle) ??
    stringValue(stream?.displayTitle)
  );
}

export function deriveSelectedAudioTrack(
  item: PlexMetadataItem,
  selection?: PlexMediaSelection,
  libraryItem?: PlexMetadataItem,
): PlaybackAudioSelection | undefined {
  const part = resolveSelectedPart(item, selection)?.part;
  if (!part) {
    return undefined;
  }

  const audioStreams = streamEntries(part).filter((stream) =>
    isAudioStream(stream),
  );
  if (audioStreams.length === 0) {
    return undefined;
  }

  const selectedAudioIndex = audioStreams.findIndex((stream) =>
    isSelectedEntry(stream),
  );
  if (selectedAudioIndex === -1 && audioStreams.length > 1) {
    return undefined;
  }

  const trackIndex = Math.max(selectedAudioIndex, 0);
  const selectedAudioStream = audioStreams[trackIndex];
  // Session stream lists may be partial, and enrichment can append live-only
  // streams. Only the matching library part establishes source audio ordering.
  const libraryAudio = streamEntries(
    resolveSelectedPart(libraryItem, selection)?.part,
  ).filter((stream) => isAudioStream(stream));
  const libraryStream = correspondingStream(libraryAudio, selectedAudioStream);
  const libraryIndex = libraryStream ? libraryAudio.indexOf(libraryStream) : -1;

  return {
    trackNumber: libraryIndex === -1 ? undefined : libraryIndex + 1,
    languageCode:
      stringValue(selectedAudioStream?.languageCode) ??
      stringValue(selectedAudioStream?.languageTag),
    title: selectedAudioTrackTitle(selectedAudioStream),
  };
}
