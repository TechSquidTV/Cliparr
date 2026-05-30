/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  compactLogFields,
  logDurationFields,
  logErrorFields,
  logEventFields,
  sanitizeUrlForLog,
} from "@cliparr/shared/logging";

void test("builds flat event and duration logging fields", () => {
  assert.deepEqual(logEventFields("editor.export", "success"), {
    "event.name": "editor.export",
    "event.outcome": "success",
  });
  assert.deepEqual(logDurationFields(100, 175), {
    "event.duration.ms": 75,
  });
});

void test("compacts undefined log fields without changing dot-notated keys", () => {
  assert.deepEqual(
    compactLogFields({
      "source.id": "source-1",
      "source.name": undefined,
      "source.enabled": false,
    }),
    {
      "source.id": "source-1",
      "source.enabled": false,
    },
  );
});

void test("summarizes errors and sanitized URLs for logs", () => {
  const error = new Error("Nope") as Error & { code?: string };
  error.code = "E_NOPE";

  assert.deepEqual(logErrorFields(error), {
    "error.name": "Error",
    "error.message": "Nope",
    "error.code": "E_NOPE",
  });
  assert.equal(
    sanitizeUrlForLog("https://user:secret@example.test/path/video.mp4?x=1#y"),
    "https://example.test/path/video.mp4",
  );
  assert.equal(
    sanitizeUrlForLog("/api/media/handle?token=secret"),
    "/api/media/handle",
  );
});
