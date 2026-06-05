import {
  buildLocalEditorSession,
  type BrowserFileHandle,
  type BrowserFilePermissionState,
  type EditorFileHandleMediaSource,
  type EditorFileMediaSource,
  type EditorSession,
  type EditorUrlMediaSource,
  titleFromFileName,
  titleFromUrl,
} from "@/lib/editorMedia";
import { cliparrClient } from "@/api/cliparrClient";
import { isHlsPlaylistUrl } from "@/lib/mediabunnyInput";

const DATABASE_NAME = "cliparr-local-media";
const DATABASE_VERSION = 1;
const STORE_NAME = "media";

const VIDEO_PICKER_TYPES = [
  {
    description: "Video files",
    accept: {
      "video/*": [
        ".mp4",
        ".m4v",
        ".mov",
        ".mkv",
        ".webm",
        ".ogv",
        ".ts",
        ".m2ts",
        ".mts",
      ],
      "application/x-matroska": [".mkv"],
      "video/mp2t": [".ts", ".m2ts", ".mts"],
    },
  },
] as const;

export const LOCAL_VIDEO_FILE_ACCEPT = [
  "video/*",
  "video/x-matroska",
  "application/x-matroska",
  "video/mp2t",
  ".mp4",
  ".m4v",
  ".mov",
  ".mkv",
  ".webm",
  ".ogv",
  ".ts",
  ".m2ts",
  ".mts",
].join(",");

type StoredLocalMediaRecord = StoredUrlRecord | StoredFileHandleRecord;

interface StoredRecordBase {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredUrlRecord extends StoredRecordBase {
  kind: "url";
  url: string;
  hls: boolean;
}

export interface StoredFileHandleRecord extends StoredRecordBase {
  kind: "file-handle";
  name: string;
  type?: string;
  size?: number;
  lastModified?: number;
  handle: BrowserFileHandle;
}

export interface MemoryFileRecord extends StoredRecordBase {
  kind: "memory-file";
  name: string;
  type?: string;
  size?: number;
  lastModified?: number;
  file: File;
}

export type LocalMediaRecord = StoredLocalMediaRecord | MemoryFileRecord;

export type LocalMediaResolution =
  | { status: "ready"; session: EditorSession }
  | { status: "missing"; title?: string; message: string }
  | { status: "permission-needed"; id: string; title: string; message: string }
  | { status: "unavailable"; title?: string; message: string };

interface BrowserWithFilePicker extends Window {
  showOpenFilePicker?: (options?: {
    excludeAcceptAllOption?: boolean;
    multiple?: boolean;
    types?: typeof VIDEO_PICKER_TYPES;
  }) => Promise<BrowserFileHandle[]>;
}

const memoryRecords = new Map<string, LocalMediaRecord>();

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function nowIsoString() {
  return new Date().toISOString();
}

function canUseIndexedDatabase() {
  return typeof indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  if (!canUseIndexedDatabase()) {
    return Promise.reject(
      new Error("IndexedDB is unavailable in this browser."),
    );
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Could not open local media storage."));
    });
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = callback(store);

        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () =>
          reject(
            request.error ?? new Error("Local media storage request failed."),
          ),
        );
        transaction.addEventListener("complete", () => database.close());
        transaction.addEventListener("error", () => {
          database.close();
          reject(
            transaction.error ??
              new Error("Local media storage transaction failed."),
          );
        });
        transaction.addEventListener("abort", () => {
          database.close();
          reject(
            transaction.error ??
              new Error("Local media storage transaction was aborted."),
          );
        });
      }),
  );
}

async function putStoredRecord(record: StoredLocalMediaRecord) {
  await withStore("readwrite", (store) => store.put(record));
}

async function getStoredRecord(id: string) {
  return withStore<StoredLocalMediaRecord | undefined>(
    "readonly",
    (store) => store.get(id) as IDBRequest<StoredLocalMediaRecord | undefined>,
  );
}

function createMemoryFileSource(
  record: MemoryFileRecord,
): EditorFileMediaSource {
  return {
    kind: "file",
    role: "local-file",
    label: "Local file",
    file: record.file,
    fileName: record.name,
    mimeType: record.type,
    size: record.size,
    lastModified: record.lastModified,
  };
}

function createFileHandleSource(
  record: StoredFileHandleRecord,
): EditorFileHandleMediaSource {
  return {
    kind: "file-handle",
    role: "local-file",
    label: "Local file",
    handle: record.handle,
    fileName: record.name,
    mimeType: record.type,
    size: record.size,
    lastModified: record.lastModified,
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function createUrlSource(
  record: StoredUrlRecord,
): Promise<EditorUrlMediaSource> {
  const proxied = await cliparrClient.createLocalMediaUrl(record.url);

  return {
    kind: "url",
    role: "direct-url",
    label: record.hls ? "HLS URL" : "URL",
    url: proxied.mediaUrl,
    originalUrl: record.url,
    hls: record.hls || proxied.hls,
  };
}

async function sessionFromRecord(record: LocalMediaRecord) {
  if (record.kind === "memory-file") {
    return buildLocalEditorSession({
      id: record.id,
      title: record.title,
      source: createMemoryFileSource(record),
    });
  }

  if (record.kind === "file-handle") {
    return buildLocalEditorSession({
      id: record.id,
      title: record.title,
      source: createFileHandleSource(record),
    });
  }

  return buildLocalEditorSession({
    id: record.id,
    title: record.title,
    source: await createUrlSource(record),
  });
}

async function readPermission(handle: BrowserFileHandle) {
  if (!handle.queryPermission) {
    return "granted" satisfies BrowserFilePermissionState;
  }

  return handle.queryPermission({ mode: "read" });
}

async function requestReadPermission(handle: BrowserFileHandle) {
  if (!handle.requestPermission) {
    return readPermission(handle);
  }

  return handle.requestPermission({ mode: "read" });
}

export async function resolveFileHandleReadPermission(
  handle: BrowserFileHandle,
  options: { requestPermission?: boolean } = {},
) {
  return options.requestPermission
    ? requestReadPermission(handle)
    : readPermission(handle);
}

function fileMetadata(file: File) {
  return {
    name: file.name,
    type: file.type || undefined,
    size: file.size,
    lastModified: file.lastModified,
  };
}

export function validateLocalMediaUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false as const, message: "Enter a media URL." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false as const, message: "Enter a valid absolute URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false as const,
      message: "Media URLs must use HTTP or HTTPS.",
    };
  }

  return {
    ok: true as const,
    url: parsed.toString(),
    hls: isHlsPlaylistUrl(parsed.toString()),
  };
}

export function localMediaPickerSupported() {
  return (
    globalThis.window !== undefined &&
    typeof (globalThis as unknown as BrowserWithFilePicker)
      .showOpenFilePicker === "function"
  );
}

export async function createLocalSessionFromFile(file: File) {
  const timestamps = nowIsoString();
  const metadata = fileMetadata(file);
  const record: MemoryFileRecord = {
    id: createId(),
    kind: "memory-file",
    title: titleFromFileName(metadata.name),
    createdAt: timestamps,
    updatedAt: timestamps,
    file,
    ...metadata,
  };

  memoryRecords.set(record.id, record);

  return sessionFromRecord(record);
}

export async function createLocalSessionFromPicker() {
  const picker =
    globalThis.window === undefined
      ? undefined
      : (globalThis as unknown as BrowserWithFilePicker).showOpenFilePicker;

  if (!picker) {
    return { status: "unsupported" as const };
  }

  try {
    const handles = await picker({
      excludeAcceptAllOption: false,
      multiple: false,
      types: VIDEO_PICKER_TYPES,
    });
    const handle = handles[0];
    if (!handle) {
      return { status: "cancelled" as const };
    }

    const file = await handle.getFile();
    const metadata = fileMetadata(file);
    const timestamps = nowIsoString();
    const record: StoredFileHandleRecord = {
      id: createId(),
      kind: "file-handle",
      title: titleFromFileName(metadata.name || handle.name),
      createdAt: timestamps,
      updatedAt: timestamps,
      handle,
      ...metadata,
      name: metadata.name || handle.name,
    };

    memoryRecords.set(record.id, record);
    await putStoredRecord(record).catch(() => {});

    return {
      status: "ready" as const,
      session: await sessionFromRecord(record),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { status: "cancelled" as const };
    }

    return {
      status: "error" as const,
      message:
        error instanceof Error ? error.message : "Could not open that file.",
    };
  }
}

export async function createLocalSessionFromUrl(value: string) {
  const validation = validateLocalMediaUrl(value);
  if (!validation.ok) {
    return {
      status: "invalid" as const,
      message: validation.message,
    };
  }

  const timestamps = nowIsoString();
  const record: StoredUrlRecord = {
    id: createId(),
    kind: "url",
    title: titleFromUrl(validation.url),
    url: validation.url,
    hls: validation.hls,
    createdAt: timestamps,
    updatedAt: timestamps,
  };

  let session: EditorSession;
  try {
    session = await sessionFromRecord(record);
  } catch (error) {
    return {
      status: "invalid" as const,
      message: errorMessage(error, "Could not open that URL."),
    };
  }

  memoryRecords.set(record.id, record);
  await putStoredRecord(record).catch(() => {});

  return {
    status: "ready" as const,
    session,
  };
}

export async function resolveLocalMediaSession(
  id: string,
  options: { requestPermission?: boolean } = {},
): Promise<LocalMediaResolution> {
  const memoryRecord = memoryRecords.get(id);
  if (memoryRecord) {
    try {
      return {
        status: "ready",
        session: await sessionFromRecord(memoryRecord),
      };
    } catch (error) {
      return {
        status: "unavailable",
        title: memoryRecord.title,
        message: errorMessage(
          error,
          "This local video URL could not be opened.",
        ),
      };
    }
  }

  let storedRecord: StoredLocalMediaRecord | undefined;
  try {
    storedRecord = await getStoredRecord(id);
  } catch {
    return {
      status: "unavailable",
      message: "Reopen this file or URL to continue.",
    };
  }

  if (!storedRecord) {
    return {
      status: "missing",
      message:
        "This local video is no longer available. Reopen it to continue.",
    };
  }

  if (storedRecord.kind === "url") {
    try {
      return {
        status: "ready",
        session: await sessionFromRecord(storedRecord),
      };
    } catch (error) {
      return {
        status: "unavailable",
        title: storedRecord.title,
        message: errorMessage(
          error,
          "This local video URL could not be opened.",
        ),
      };
    }
  }

  try {
    const permission = await resolveFileHandleReadPermission(
      storedRecord.handle,
      options,
    );

    if (permission !== "granted") {
      return {
        status: "permission-needed",
        id: storedRecord.id,
        title: storedRecord.title,
        message: "Allow access to reopen this file.",
      };
    }

    const file = await storedRecord.handle.getFile();
    const metadata = fileMetadata(file);
    const nextRecord: StoredFileHandleRecord = {
      ...storedRecord,
      ...metadata,
      name: metadata.name || storedRecord.name,
      title: titleFromFileName(metadata.name || storedRecord.name),
      updatedAt: nowIsoString(),
    };

    await putStoredRecord(nextRecord).catch(() => {});

    return { status: "ready", session: await sessionFromRecord(nextRecord) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      return {
        status: "permission-needed",
        id: storedRecord.id,
        title: storedRecord.title,
        message: "Allow access to reopen this file.",
      };
    }

    return {
      status: "unavailable",
      title: storedRecord.title,
      message: "Could not reopen this file.",
    };
  }
}
