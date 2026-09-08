import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createEditorDraftStore,
  editorDraftIdentity,
  type EditorDraft,
} from "@/components/editor/editorDrafts";
import { buildLocalEditorSession, type EditorSession } from "@/lib/editorMedia";

function session(name = "clip.mp4", size = 5, lastModified = 1): EditorSession {
  const file = new File([new Uint8Array(size)], name, { lastModified });
  return buildLocalEditorSession({
    id: name,
    title: name,
    duration: 30,
    source: {
      kind: "file",
      role: "direct",
      label: "Local file",
      file,
      fileName: file.name,
    },
  });
}
function draftFor(media: EditorSession): EditorDraft {
  return {
    version: 1,
    identity: editorDraftIdentity(media),
    sessionId: media.id,
    updatedAt: Date.now(),
    duration: 30,
    startTime: 5,
    endTime: 20,
    subtitles: {
      selectedTrackKey: "stream:1",
      importedTrackKey: "stream:1",
      enabled: true,
      visible: false,
      cues: [
        {
          id: "1",
          startTime: 6,
          endTime: 8,
          text: "Edited caption",
          lines: ["Edited caption"],
        },
      ],
    },
  };
}
function storage() {
  let raw: string | null = null;
  return {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
}

void test("restores clip and subtitle edits from storage with a new local registry id", () => {
  const media = session();
  const saved = draftFor(media);
  const persistent = storage();
  assert.equal(createEditorDraftStore(() => persistent).save(saved), true);
  const reopened = { ...media, id: "reopened-file" };
  assert.deepEqual(
    createEditorDraftStore(() => persistent).read(reopened),
    saved,
  );
});

void test("does not apply drafts to a different or modified file", () => {
  const store = createEditorDraftStore(() => storage());
  store.save(draftFor(session()));
  assert.equal(store.read(session("different.mp4")), null);
  assert.equal(store.read(session("clip.mp4", 6)), null);
  assert.equal(store.read(session("clip.mp4", 5, 2)), null);
});

void test("does not retain provider media credentials in identity or draft storage", () => {
  const local = session();
  const media: EditorSession = {
    ...local,
    local: false,
    source: { id: "source", name: "Plex", providerId: "plex" },
    directSource: {
      kind: "url",
      role: "direct",
      label: "Direct",
      url: "https://example.com/file?token=private",
    },
  };
  const persistent = storage();
  createEditorDraftStore(() => persistent).save(draftFor(media));
  assert.doesNotMatch(persistent.getItem() ?? "", /private|https|token/);
});

void test("ignores corrupt, malformed, expired, and unsupported draft records", () => {
  const media = session();
  for (const raw of [
    "not json",
    "null",
    "{}",
    "[null]",
    JSON.stringify([{ ...draftFor(media), version: 2 }]),
    JSON.stringify([{ ...draftFor(media), subtitles: { cues: [null] } }]),
    JSON.stringify([
      { ...draftFor(media), updatedAt: Date.now() - 15 * 86_400_000 },
    ]),
  ]) {
    const persistent = { getItem: () => raw, setItem: () => {} };
    assert.equal(createEditorDraftStore(() => persistent).read(media), null);
  }
});

void test("keeps navigation recovery in memory when storage fails and allows reset", () => {
  const store = createEditorDraftStore(() => {
    throw new Error("Storage denied");
  });
  const media = session();
  assert.equal(store.save(draftFor(media)), false);
  assert.ok(store.read(media));
  store.remove(media);
  assert.equal(store.read(media), null);
});

void test("reset removes persisted drafts and limits retained drafts to twenty", () => {
  const persistent = storage();
  const store = createEditorDraftStore(() => persistent);
  for (let index = 0; index < 22; index += 1) {
    store.save(draftFor(session(`clip-${index}.mp4`)));
  }
  const records = JSON.parse(persistent.getItem() ?? "[]") as EditorDraft[];
  assert.equal(records.length, 20);
  const media = session("clip-21.mp4");
  assert.equal(store.remove(media), true);
  assert.equal(createEditorDraftStore(() => persistent).read(media), null);
});

void test("separates different media when a provider reuses its playback session id", () => {
  const media = { ...session(), local: false };
  const persistent = storage();
  const store = createEditorDraftStore(() => persistent);
  store.save(draftFor(media));
  assert.equal(store.read({ ...media, title: "Next episode" }), null);
});
