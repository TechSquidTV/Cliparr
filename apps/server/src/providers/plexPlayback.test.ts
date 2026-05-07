import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewPath } from "./plex/playback.js";

void test("uses a stable Plex transcode session id for repeated playback polls", () => {
  const item = {
    ratingKey: "12345",
    Media: [{
      id: "media-1",
      selected: 1,
      Part: [{
        id: "part-1",
        selected: 1,
      }],
    }],
  };

  const firstPath = createPreviewPath(item, "plex-session-1");
  const secondPath = createPreviewPath(item, "plex-session-1");
  const differentSessionPath = createPreviewPath(item, "plex-session-2");

  assert.equal(firstPath, secondPath);
  assert.notEqual(firstPath, differentSessionPath);
  assert.match(firstPath ?? "", /transcodeSessionId=plex-session-1/);
});
