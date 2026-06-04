/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  downloadSubtitleCues,
  subtitleCueLoadKey,
  subtitleResponseDiagnosticFields,
  subtitleResponseDiagnostics,
} from "@/components/editor/useSubtitleCues";
import type { PlaybackSubtitleTrack } from "@/providers/types";

const baseTrack = {
  streamId: "10",
  index: 2,
  languageCode: "eng",
  title: "English",
  codec: "srt",
  contentFormat: "srt",
  isText: true,
  contentUrl: "/api/media/subtitle-old",
} satisfies PlaybackSubtitleTrack;

void test("subtitle cue load keys include the selected content URL", () => {
  assert.notEqual(
    subtitleCueLoadKey(baseTrack),
    subtitleCueLoadKey({
      ...baseTrack,
      contentUrl: "/api/media/subtitle-new",
    }),
  );
});

void test("subtitle cue load keys change when loadability or format changes", () => {
  assert.notEqual(
    subtitleCueLoadKey(baseTrack),
    subtitleCueLoadKey({
      ...baseTrack,
      contentUrl: undefined,
    }),
  );
  assert.notEqual(
    subtitleCueLoadKey(baseTrack),
    subtitleCueLoadKey({
      ...baseTrack,
      contentFormat: "vtt",
    }),
  );
});

void test("subtitle response diagnostics include empty 200 responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("", {
      status: 200,
      headers: {
        "content-length": "0",
        "content-type": "text/srt",
      },
    })) as typeof fetch;

  try {
    const result = await downloadSubtitleCues(
      baseTrack,
      "/api/media/subtitle",
      new AbortController().signal,
    );

    assert.equal(result.ok, true);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.contentType, "text/srt");
    assert.equal(result.response.contentLength, 0);
    assert.equal(result.response.charCount, 0);
    assert.equal(result.response.empty, true);
    if (result.ok) {
      assert.equal(result.cues.length, 0);
    }

    const fields = subtitleResponseDiagnosticFields(result.response, 0);
    assert.equal(fields["http.status_code"], 200);
    assert.equal(fields["http.content_type"], "text/srt");
    assert.equal(fields["http.content_length"], 0);
    assert.equal(fields["subtitle.response.char_count"], 0);
    assert.equal(fields["subtitle.response.empty"], true);
    assert.equal(fields["subtitle.cue.count"], 0);
    assert.equal(fields["subtitle.empty"], true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("subtitle response diagnostics include non-empty unparsable bodies", async () => {
  const originalFetch = globalThis.fetch;
  const body = "not really subtitles";
  globalThis.fetch = (async () =>
    new Response(body, {
      status: 200,
      headers: {
        "content-length": String(body.length),
        "content-type": "text/plain",
      },
    })) as typeof fetch;

  try {
    const result = await downloadSubtitleCues(
      baseTrack,
      "/api/media/subtitle",
      new AbortController().signal,
    );

    assert.equal(result.ok, true);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.contentType, "text/plain");
    assert.equal(result.response.contentLength, body.length);
    assert.equal(result.response.charCount, body.length);
    assert.equal(result.response.empty, false);
    if (result.ok) {
      assert.equal(result.cues.length, 0);
    }

    const fields = subtitleResponseDiagnosticFields(result.response, 0);
    assert.equal(fields["subtitle.response.char_count"], body.length);
    assert.equal(fields["subtitle.response.empty"], false);
    assert.equal(fields["subtitle.cue.count"], 0);
    assert.equal(fields["subtitle.empty"], true);
    assert.equal(Object.values(fields).includes(body), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("subtitle response diagnostics include non-OK status without body text", async () => {
  const originalFetch = globalThis.fetch;
  const body = "missing subtitle body";
  globalThis.fetch = (async () =>
    new Response(body, {
      status: 501,
      headers: {
        "content-length": String(body.length),
        "content-type": "text/html",
      },
    })) as typeof fetch;

  try {
    const result = await downloadSubtitleCues(
      baseTrack,
      "/api/media/subtitle",
      new AbortController().signal,
    );

    assert.equal(result.ok, false);
    assert.equal(result.response.status, 501);
    assert.equal(result.response.contentType, "text/html");
    assert.equal(result.response.contentLength, body.length);
    assert.equal(result.response.charCount, body.length);
    assert.equal(result.response.empty, false);
    if (!result.ok) {
      assert.equal(result.failure.status, 501);
      assert.equal(result.failure.message, "Could not load subtitles (501).");
    }

    const fields = subtitleResponseDiagnosticFields(result.response, 0);
    assert.equal(fields["http.status_code"], 501);
    assert.equal(fields["http.content_type"], "text/html");
    assert.equal(fields["subtitle.response.char_count"], body.length);
    assert.equal(fields["subtitle.response.empty"], false);
    assert.equal(fields["subtitle.cue.count"], 0);
    assert.equal(Object.values(fields).includes(body), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("subtitle response diagnostics ignore invalid content-length values", () => {
  const diagnostics = subtitleResponseDiagnostics(
    new Response("hello", {
      status: 200,
      headers: {
        "content-length": "not-a-number",
        "content-type": "text/srt",
      },
    }),
    "hello",
  );

  assert.equal(diagnostics.status, 200);
  assert.equal(diagnostics.contentType, "text/srt");
  assert.equal(diagnostics.contentLength, undefined);
  assert.equal(diagnostics.charCount, 5);
  assert.equal(diagnostics.empty, false);
});
