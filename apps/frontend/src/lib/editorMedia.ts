import type {
  CurrentlyPlayingItem,
  MediaExportMetadata,
  PlaybackAudioSelection,
  PlaybackExportEstimateMetadata,
  PlaybackSource,
  PlaybackSubtitleSelection,
  PlaybackSubtitleTrack,
} from "@/providers/types";
import { isHlsPlaylistUrl } from "@/lib/mediabunnyInput";
import { subtitleTrackKey } from "@/lib/selectPreferredSubtitleTrack";

const LOCAL_PROVIDER_ID = "local";

export type BrowserFilePermissionState = "granted" | "denied" | "prompt";

export interface BrowserFileHandle {
  kind?: "file";
  name: string;
  getFile: () => Promise<File>;
  queryPermission?: (descriptor?: {
    mode?: "read";
  }) => Promise<BrowserFilePermissionState>;
  requestPermission?: (descriptor?: {
    mode?: "read";
  }) => Promise<BrowserFilePermissionState>;
}

export type EditorMediaSourceRole =
  | "hls"
  | "direct"
  | "local-file"
  | "direct-url";

interface BaseEditorMediaSource {
  role: EditorMediaSourceRole;
  label: string;
}

export interface EditorUrlMediaSource extends BaseEditorMediaSource {
  kind: "url";
  url: string;
  originalUrl?: string;
  hls?: boolean;
}

export interface EditorFileMediaSource extends BaseEditorMediaSource {
  kind: "file";
  file: File;
  fileName: string;
  mimeType?: string;
  size?: number;
  lastModified?: number;
}

export interface EditorFileHandleMediaSource extends BaseEditorMediaSource {
  kind: "file-handle";
  handle: BrowserFileHandle;
  fileName: string;
  mimeType?: string;
  size?: number;
  lastModified?: number;
}

export type EditorMediaSource =
  | EditorUrlMediaSource
  | EditorFileMediaSource
  | EditorFileHandleMediaSource;

export interface EditorSession {
  id: string;
  source: PlaybackSource;
  title: string;
  type: string;
  duration: number;
  initialPlayheadSeconds?: number;
  playerTitle: string;
  playerState: string;
  thumbUrl?: string;
  directSource?: EditorMediaSource;
  hlsSource?: EditorMediaSource;
  selectedAudioTrack?: PlaybackAudioSelection;
  selectedSubtitleTrack?: PlaybackSubtitleSelection;
  subtitleTracks?: PlaybackSubtitleTrack[];
  exportMetadata?: MediaExportMetadata;
  exportEstimateMetadata?: PlaybackExportEstimateMetadata;
  local: boolean;
}

export function titleFromFileName(fileName: string) {
  const trimmed = fileName.trim();
  const withoutExtension = trimmed.replace(/\.[^.]+$/, "");
  return withoutExtension || trimmed || "Local video";
}

export function titleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const finalSegment = decodeURIComponent(
      parsed.pathname.split("/").filter(Boolean).pop() ?? "",
    );
    return finalSegment
      ? titleFromFileName(finalSegment)
      : parsed.hostname || "URL video";
  } catch {
    return "URL video";
  }
}

export function createProviderUrlSource(
  url: string,
  role: Extract<EditorMediaSourceRole, "hls" | "direct">,
): EditorUrlMediaSource {
  return {
    kind: "url",
    role,
    url,
    hls: role === "hls" || isHlsPlaylistUrl(url),
    label: role === "hls" ? "HLS playback" : "Direct/original",
  };
}

export function editorSessionFromCurrentlyPlaying(
  item: CurrentlyPlayingItem,
): EditorSession {
  return {
    id: item.id,
    source: item.source,
    title: item.title,
    type: item.type,
    duration: item.duration,
    initialPlayheadSeconds: item.playheadSeconds,
    playerTitle: item.playerTitle,
    playerState: item.playerState,
    thumbUrl: item.thumbUrl,
    directSource: item.mediaUrl
      ? createProviderUrlSource(item.mediaUrl, "direct")
      : undefined,
    hlsSource: item.hlsUrl
      ? createProviderUrlSource(item.hlsUrl, "hls")
      : undefined,
    selectedAudioTrack: item.selectedAudioTrack,
    selectedSubtitleTrack: item.selectedSubtitleTrack,
    subtitleTracks: item.subtitleTracks,
    exportMetadata: item.exportMetadata,
    exportEstimateMetadata: item.exportEstimateMetadata,
    local: false,
  };
}

function preserveUrlSourceHandle(
  current: EditorMediaSource | undefined,
  next: EditorMediaSource | undefined,
) {
  if (!next) {
    return undefined;
  }

  if (
    current?.kind === "url" &&
    next.kind === "url" &&
    current.role === next.role
  ) {
    return current;
  }

  return next;
}

function audioSelectionsEqual(
  left: PlaybackAudioSelection | undefined,
  right: PlaybackAudioSelection | undefined,
) {
  return (
    left?.trackNumber === right?.trackNumber &&
    left?.languageCode === right?.languageCode &&
    left?.title === right?.title
  );
}

function subtitleSelectionsEqual(
  left: PlaybackSubtitleSelection | undefined,
  right: PlaybackSubtitleSelection | undefined,
) {
  return (
    left?.streamId === right?.streamId &&
    left?.index === right?.index &&
    left?.languageCode === right?.languageCode &&
    left?.title === right?.title &&
    left?.codec === right?.codec &&
    left?.contentFormat === right?.contentFormat &&
    left?.isText === right?.isText
  );
}

function preserveSubtitleTrackHandles(
  currentTracks: readonly PlaybackSubtitleTrack[] | undefined,
  nextTracks: readonly PlaybackSubtitleTrack[] | undefined,
): PlaybackSubtitleTrack[] | undefined {
  if (!nextTracks) {
    return undefined;
  }

  if (!currentTracks || currentTracks.length === 0) {
    return [...nextTracks];
  }

  const currentTrackByKey = new Map(
    currentTracks.map((track) => [subtitleTrackKey(track), track] as const),
  );

  return nextTracks.map((track) => {
    const currentTrack = currentTrackByKey.get(subtitleTrackKey(track));
    if (!currentTrack?.contentUrl || !track.contentUrl) {
      return track;
    }

    return {
      ...track,
      contentUrl: currentTrack.contentUrl,
    };
  });
}

export function mergeEditorSessionRefresh(
  current: EditorSession | null | undefined,
  next: EditorSession,
): EditorSession {
  if (!current || current.id !== next.id || current.local || next.local) {
    return next;
  }

  return {
    ...next,
    initialPlayheadSeconds: current.initialPlayheadSeconds,
    thumbUrl:
      next.thumbUrl && current.thumbUrl ? current.thumbUrl : next.thumbUrl,
    directSource: preserveUrlSourceHandle(
      current.directSource,
      next.directSource,
    ),
    hlsSource: preserveUrlSourceHandle(current.hlsSource, next.hlsSource),
    selectedAudioTrack: audioSelectionsEqual(
      current.selectedAudioTrack,
      next.selectedAudioTrack,
    )
      ? current.selectedAudioTrack
      : next.selectedAudioTrack,
    selectedSubtitleTrack: subtitleSelectionsEqual(
      current.selectedSubtitleTrack,
      next.selectedSubtitleTrack,
    )
      ? current.selectedSubtitleTrack
      : next.selectedSubtitleTrack,
    subtitleTracks: preserveSubtitleTrackHandles(
      current.subtitleTracks,
      next.subtitleTracks,
    ),
  };
}

export function buildLocalEditorSession(input: {
  id: string;
  title: string;
  source: EditorMediaSource;
  duration?: number;
}): EditorSession {
  const isHls = isHlsEditorMediaSource(input.source);
  const title = input.title.trim() || "Local video";

  return {
    id: input.id,
    source: {
      id: LOCAL_PROVIDER_ID,
      name: "Local video",
      providerId: LOCAL_PROVIDER_ID,
    },
    title,
    type: "video",
    duration: input.duration ?? 0,
    playerTitle: sourceDisplayLabel(input.source),
    playerState: "ready",
    directSource: isHls ? undefined : input.source,
    hlsSource: isHls ? input.source : undefined,
    exportMetadata: {
      providerId: LOCAL_PROVIDER_ID,
      itemType: "video",
      title,
      sourceTitle: title,
    },
    exportEstimateMetadata: buildLocalExportEstimateMetadata(
      input.source,
      input.duration,
    ),
    local: true,
  };
}

function buildLocalExportEstimateMetadata(
  source: EditorMediaSource,
  duration?: number,
): PlaybackExportEstimateMetadata | undefined {
  const sourceSizeBytes =
    source.kind === "file"
      ? (source.size ?? source.file.size)
      : source.kind === "file-handle"
        ? source.size
        : undefined;
  const sourceDurationSeconds =
    typeof duration === "number" && duration > 0 ? duration : undefined;

  if (!sourceSizeBytes && !sourceDurationSeconds) {
    return undefined;
  }

  return {
    sourceSizeBytes,
    sourceDurationSeconds,
  };
}

export function isHlsEditorMediaSource(source: EditorMediaSource) {
  return (
    source.kind === "url" &&
    (source.hls === true || isHlsPlaylistUrl(source.url))
  );
}

export function sourceDisplayLabel(source: EditorMediaSource) {
  if (source.role === "local-file") {
    return "Local file";
  }

  if (source.role === "direct-url") {
    return isHlsEditorMediaSource(source) ? "HLS URL" : "URL";
  }

  return source.label;
}

export function editorMediaSourcesEqual(
  left: EditorMediaSource,
  right: EditorMediaSource,
) {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "url" && right.kind === "url") {
    return left.url === right.url;
  }

  if (left.kind === "file" && right.kind === "file") {
    return left.file === right.file;
  }

  if (left.kind === "file-handle" && right.kind === "file-handle") {
    return left.handle === right.handle;
  }

  return false;
}
