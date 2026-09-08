import assert from "node:assert/strict";
import { test } from "node:test";
import type { MediabunnySourceState } from "@techsquidtv/canvas-timeline-mediabunny-adapter";
import {
  createEditorPreviewSourceLoader,
  editorPreviewFrameTime,
  resolveEditorExportMedia,
  type EditorMediaMetadata,
} from "@/components/editor/editorMediaLifecycle";
import type { PlaybackSourceCandidate } from "@/components/editor/editorPlaybackSources";

const sourceId = "editor-media-source";
const candidates: readonly PlaybackSourceCandidate[] = [
  {
    label: "hls stream",
    source: { kind: "url", role: "hls", label: "HLS", url: "/stream.m3u8" },
  },
  {
    label: "direct source",
    source: { kind: "url", role: "direct", label: "Direct", url: "/video.mkv" },
  },
];
const hlsMetadata: EditorMediaMetadata = {
  duration: 30,
  frameStepSeconds: 1 / 30,
  previewVideoDimensions: { width: 1280, height: 720 },
  sourceVideoDimensions: { width: 1280, height: 720 },
  timelineOffsetSeconds: 1_700_000_000,
};
const directMetadata: EditorMediaMetadata = {
  ...hlsMetadata,
  duration: 35,
  sourceVideoDimensions: { width: 3840, height: 2160 },
  timelineOffsetSeconds: 0,
};
const preparedInputs = new Map([
  [0, hlsMetadata],
  [1, directMetadata],
]);
const failure = new Error("Temporary preview failure");

void test("rejects stale frame timestamps across HLS/direct timeline origins", () => {
  assert.equal(editorPreviewFrameTime(1_700_000_004, 1_700_000_000, 30), 4);
  assert.equal(editorPreviewFrameTime(4, 0, 30), 4);
  assert.equal(editorPreviewFrameTime(null, 0, 30), null);
  assert.equal(editorPreviewFrameTime(1_700_000_004, 0, 30), null);
  assert.equal(editorPreviewFrameTime(4, 1_700_000_000, 30), null);
  assert.equal(editorPreviewFrameTime(Number.NaN, 0, 30), null);
});

function sourceState(
  overrides: Partial<MediabunnySourceState> = {},
): MediabunnySourceState {
  return {
    sourceId,
    status: "idle",
    selectedInputIndex: null,
    metadata: null,
    attempts: [],
    error: null,
    ...overrides,
  };
}

void test("does not treat registration or prepared tracks as export readiness", () => {
  assert.equal(
    resolveEditorExportMedia(null, sourceState(), candidates, preparedInputs),
    null,
  );
});

void test("uses direct export fallback when HLS never successfully loaded", () => {
  const result = resolveEditorExportMedia(
    null,
    sourceState({
      status: "ready",
      selectedInputIndex: 1,
      attempts: [
        { inputIndex: 0, status: "failed", error: failure },
        { inputIndex: 1, status: "ready", error: null },
      ],
    }),
    candidates,
    preparedInputs,
  );
  assert.equal(result?.candidate, candidates[1]);
  assert.equal(result?.metadata, directMetadata);
});

void test("runtime fallback preserves the first successful source even before React observed ready", () => {
  const result = resolveEditorExportMedia(
    null,
    sourceState({
      status: "ready",
      selectedInputIndex: 1,
      attempts: [
        { inputIndex: 0, status: "ready", error: null },
        { inputIndex: 0, status: "failed", error: failure },
        { inputIndex: 1, status: "ready", error: null },
      ],
    }),
    candidates,
    preparedInputs,
  );
  assert.equal(result?.candidate, candidates[0]);
  assert.equal(result?.metadata, hlsMetadata);
});

void test("retains export readiness through terminal preview failure and retry", () => {
  const previous = { candidate: candidates[0]!, metadata: hlsMetadata };
  for (const status of ["failed", "loading", "recovering", "ready"] as const) {
    assert.equal(
      resolveEditorExportMedia(
        previous,
        sourceState({ status }),
        candidates,
        preparedInputs,
      ),
      previous,
    );
  }
  // A changed source configuration supplies no previous metadata.
  assert.equal(
    resolveEditorExportMedia(null, sourceState(), candidates, new Map()),
    null,
  );
});

void test("preloads idle sources without requiring any active timeline clip", async () => {
  const calls: string[] = [];
  const ready = { ok: true, sourceId, state: "ready" } as const;
  const load = createEditorPreviewSourceLoader(
    {
      sourceStateById: new Map([[sourceId, sourceState()]]),
      preloadSource: async (id) => {
        calls.push(`preload:${id}`);
        return ready;
      },
      retrySource: async () => {
        assert.fail("Idle sources must be preloaded, not retried");
      },
    },
    sourceId,
  );
  assert.deepEqual(calls, []);
  assert.equal(await load(), ready);
  assert.deepEqual(calls, [`preload:${sourceId}`]);
});

void test("coalesces explicit retries and does not automatically retry a failure", async () => {
  let retryCalls = 0;
  const failed = {
    ok: false,
    sourceId,
    reason: "load-failed",
    error: failure,
  } as const;
  let finishRetry: (result: typeof failed) => void = () => {
    assert.fail("The retry promise has not been initialized");
  };
  const retry = new Promise<typeof failed>((resolve) => {
    finishRetry = resolve;
  });
  const load = createEditorPreviewSourceLoader(
    {
      sourceStateById: new Map([[sourceId, sourceState({ status: "failed" })]]),
      preloadSource: async () => {
        assert.fail("Failed sources require an explicit retry");
      },
      retrySource: () => {
        retryCalls += 1;
        return retry;
      },
    },
    sourceId,
  );
  const first = load();
  assert.equal(load(), first);
  assert.equal(retryCalls, 1);
  finishRetry(failed);
  assert.equal(await first, failed);
  assert.equal(retryCalls, 1);
  await load();
  assert.equal(retryCalls, 2);
});

void test("a rejected load does not prevent a subsequent explicit attempt", async () => {
  let attempts = 0;
  const load = createEditorPreviewSourceLoader(
    {
      sourceStateById: new Map(),
      preloadSource: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw failure;
        }
        return { ok: true, sourceId, state: "ready" };
      },
      retrySource: async () => {
        assert.fail("No failed source state was supplied");
      },
    },
    sourceId,
  );
  await assert.rejects(load(), failure);
  const result = await load();
  assert.equal(result.ok, true);
});
