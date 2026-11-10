import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createEditorDraftStore,
  type EditorDraft,
  editorDraftIdentity,
} from "@/components/editor/editorDrafts";
import {
  buildLocalEditorSession,
  type EditorSession,
} from "@/components/editor/editorMedia";

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
    version: 2,
    identity: editorDraftIdentity(media),
    sessionId: media.id,
    updatedAt: Date.now(),
    duration: 30,
    startTime: 5,
    endTime: 20,
    subtitles: {
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
    JSON.stringify([{ ...draftFor(media), version: 1 }]),
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

void test("persists crop geometry and ratio locks alongside subtitles without changing draft identity", () => {
  const media = session();
  const persistent = storage();
  const saved: EditorDraft = {
    ...draftFor(media),
    crop: {
      region: {
        x: 0.25,
        y: 0,
        width: 0.5,
        height: 1,
        sourceAspectRatio: 16 / 9,
      },
      aspectRatio: 8 / 9,
    },
  };
  assert.equal(createEditorDraftStore(() => persistent).save(saved), true);
  assert.deepEqual(createEditorDraftStore(() => persistent).read(media), saved);
  for (const crop of [
    {},
    { ...saved.crop, aspectRatio: -1 },
    { ...saved.crop, region: { ...saved.crop?.region, width: 2 } },
  ]) {
    persistent.setItem("", JSON.stringify([{ ...saved, crop }]));
    assert.equal(createEditorDraftStore(() => persistent).read(media), null);
  }
});

void test("keeps an oversized draft in memory without repeatedly serializing it", () => {
  const persistent = storage();
  const store = createEditorDraftStore(() => persistent);
  for (let index = 0; index < 19; index += 1) {
    assert.equal(store.save(draftFor(session(`old-${index}.mp4`))), true);
  }
  const previous = persistent.getItem();
  const media = session("oversized.mp4");
  let reads = 0;
  const cue = {
    startTime: 1,
    endTime: 2,
    get text() {
      reads += 1;
      return "x".repeat(100);
    },
    lines: [],
  };
  const oversized: EditorDraft = {
    ...draftFor(media),
    subtitles: {
      visible: true,
      cues: Array.from({ length: 10_000 }, () => cue),
    },
  };
  assert.equal(store.save(oversized), false);
  assert.equal(reads, 20_000);
  assert.equal(persistent.getItem(), previous);
  assert.equal(store.read(media), oversized);
});

void test("evicts only the oldest drafts needed to fit the storage limit", () => {
  const persistent = storage();
  const store = createEditorDraftStore(() => persistent);
  const media = [session("old.mp4"), session("middle.mp4"), session("new.mp4")];
  for (const [index, item] of media.entries()) {
    const draft = draftFor(item);
    draft.updatedAt = Date.now() + index;
    draft.subtitles.cues = [
      { startTime: 1, endTime: 2, text: "é".repeat(300_000), lines: [] },
    ];
    assert.equal(store.save(draft), true);
  }
  const reopened = createEditorDraftStore(() => persistent);
  assert.equal(reopened.read(media[0]), null);
  assert.ok(reopened.read(media[1]));
  assert.ok(reopened.read(media[2]));
  assert.ok((persistent.getItem()?.length ?? 0) * 2 <= 1_500_000);
});

void test("merges changes from another tab after reading unchanged storage", () => {
  const persistent = storage();
  const first = createEditorDraftStore(() => persistent);
  const second = createEditorDraftStore(() => persistent);
  const firstMedia = session("first.mp4");
  const secondMedia = session("second.mp4");
  const firstDraft = draftFor(firstMedia);
  assert.equal(first.save(firstDraft), true);
  assert.deepEqual(second.read(firstMedia), firstDraft);
  assert.deepEqual(second.read(firstMedia), firstDraft);
  const secondDraft = draftFor(secondMedia);
  assert.equal(second.save(secondDraft), true);
  assert.deepEqual(first.read(secondMedia), secondDraft);
  const updated = {
    ...firstDraft,
    updatedAt: firstDraft.updatedAt + 1,
    startTime: 7,
  };
  assert.equal(first.save(updated), true);
  assert.deepEqual(second.read(firstMedia), updated);
});
