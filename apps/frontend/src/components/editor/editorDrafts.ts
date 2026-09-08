import type { EditorSession } from "@/lib/editorMedia";
import type { SubtitleCue } from "@/lib/subtitles/types";

export interface EditorDraft {
  version: 1;
  identity: string;
  sessionId: string;
  updatedAt: number;
  duration: number;
  startTime: number;
  endTime: number;
  subtitles: {
    selectedTrackKey: string;
    importedTrackKey: string | null;
    enabled: boolean;
    visible: boolean;
    cues: readonly SubtitleCue[];
  };
}

type DraftStorage = Pick<Storage, "getItem" | "setItem">;
const STORAGE_KEY = "cliparr.editor.drafts.v1";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_STORAGE_BYTES = 1_500_000;

export function editorDraftIdentity(session: EditorSession) {
  const source = session.directSource ?? session.hlsSource;
  if (session.local && source && source.kind !== "url") {
    const size = source.kind === "file" ? source.file.size : source.size;
    const lastModified =
      source.kind === "file" ? source.file.lastModified : source.lastModified;
    if (size !== undefined && lastModified !== undefined) {
      return JSON.stringify(["file", source.fileName, size, lastModified]);
    }
  }
  // Provider session IDs and local registry IDs identify media without retaining
  // signed media URLs or provider credentials in draft storage.
  return JSON.stringify([
    session.source.providerId,
    session.source.id,
    session.exportMetadata?.ratingKey ?? session.id,
    session.title,
  ]);
}

function browserStorage(): DraftStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isCue(cue: Partial<SubtitleCue> | null): cue is SubtitleCue {
  return Boolean(
    cue &&
    typeof cue === "object" &&
    (cue.id === undefined || typeof cue.id === "string") &&
    typeof cue.startTime === "number" &&
    Number.isFinite(cue.startTime) &&
    cue.startTime >= 0 &&
    typeof cue.endTime === "number" &&
    Number.isFinite(cue.endTime) &&
    cue.endTime > cue.startTime &&
    typeof cue.text === "string" &&
    Array.isArray(cue.lines) &&
    cue.lines.every((line: string) => typeof line === "string"),
  );
}

function isDraft(value: Partial<EditorDraft> | null): value is EditorDraft {
  if (!value || typeof value !== "object") {
    return false;
  }
  const subtitles = value.subtitles;
  return (
    value.version === 1 &&
    typeof value.identity === "string" &&
    value.identity.length <= 4096 &&
    typeof value.sessionId === "string" &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt) &&
    typeof value.duration === "number" &&
    Number.isFinite(value.duration) &&
    value.duration > 0 &&
    typeof value.startTime === "number" &&
    Number.isFinite(value.startTime) &&
    value.startTime >= 0 &&
    typeof value.endTime === "number" &&
    Number.isFinite(value.endTime) &&
    value.endTime > value.startTime &&
    value.endTime <= value.duration + 0.5 &&
    Boolean(
      subtitles &&
      typeof subtitles === "object" &&
      typeof subtitles.selectedTrackKey === "string" &&
      (subtitles.importedTrackKey === null ||
        typeof subtitles.importedTrackKey === "string") &&
      typeof subtitles.enabled === "boolean" &&
      typeof subtitles.visible === "boolean" &&
      Array.isArray(subtitles.cues) &&
      subtitles.cues.length <= 20_000 &&
      subtitles.cues.every(isCue),
    )
  );
}

function mergeDrafts(
  incoming: readonly EditorDraft[],
  current: readonly EditorDraft[],
) {
  const merged = new Map<string, EditorDraft>();
  for (const collection of [incoming, current]) {
    for (const draft of collection) {
      const previous = merged.get(draft.identity);
      if (!previous || draft.updatedAt >= previous.updatedAt) {
        merged.set(draft.identity, draft);
      }
    }
  }
  return [...merged.values()];
}

export function createEditorDraftStore(
  getStorage: () => DraftStorage | null = browserStorage,
) {
  let drafts: EditorDraft[] = [];
  const removed = new Set<string>();
  const load = () => {
    try {
      const raw = getStorage()?.getItem(STORAGE_KEY);
      if (raw && raw.length * 2 <= MAX_STORAGE_BYTES) {
        const stored = JSON.parse(raw) as (Partial<EditorDraft> | null)[];
        if (Array.isArray(stored)) {
          drafts = mergeDrafts(stored.filter(isDraft), drafts).filter(
            (draft) => !removed.has(draft.identity),
          );
        }
      }
    } catch {
      /* Keep this tab's drafts when storage is unavailable or corrupt. */
    }
    drafts = drafts
      .filter((draft) => Date.now() - draft.updatedAt <= MAX_AGE_MS)
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);
  };
  const persist = () => {
    try {
      const storage = getStorage();
      if (!storage) {
        return false;
      }
      const retained = [...drafts];
      while (
        retained.length > 1 &&
        JSON.stringify(retained).length * 2 > MAX_STORAGE_BYTES
      ) {
        retained.pop();
      }
      const serialized = JSON.stringify(retained);
      if (serialized.length * 2 > MAX_STORAGE_BYTES) {
        return false;
      }
      storage.setItem(STORAGE_KEY, serialized);
      drafts = retained;
      return true;
    } catch {
      return false;
    }
  };
  return {
    read: (session: EditorSession) => {
      load();
      return (
        drafts.find(
          (draft) => draft.identity === editorDraftIdentity(session),
        ) ?? null
      );
    },
    hasSession: (sessionId: string) => {
      load();
      return drafts.some((draft) => draft.sessionId === sessionId);
    },
    save: (draft: EditorDraft) => {
      if (!isDraft(draft)) {
        return false;
      }
      load();
      removed.delete(draft.identity);
      drafts = [
        draft,
        ...drafts.filter((saved) => saved.identity !== draft.identity),
      ].slice(0, 20);
      return persist();
    },
    remove: (session: EditorSession) => {
      load();
      const identity = editorDraftIdentity(session);
      removed.add(identity);
      drafts = drafts.filter((draft) => draft.identity !== identity);
      return persist();
    },
  };
}

export const editorDrafts = createEditorDraftStore();
