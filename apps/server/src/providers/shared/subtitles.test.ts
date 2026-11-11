import assert from "node:assert/strict";
import test from "node:test";

import { SUBTITLE_IMPORT_TIMEOUT_MS } from "@cliparr/shared/providers";

import {
  subtitleRequestPolicy,
  subtitleTrackTraceFields,
} from "@/providers/shared/subtitles";

void test("subtitle requests wait for provider extraction once, within the editor's wait", () => {
  const policy = subtitleRequestPolicy({ kind: "subtitle" });
  assert.equal(policy?.retryAttempts, 1);
  assert.ok(policy.timeoutMs >= 60_000);
  assert.ok(policy.timeoutMs < SUBTITLE_IMPORT_TIMEOUT_MS);
  assert.equal(subtitleRequestPolicy({}), undefined);
});

void test("subtitle trace fields divide reported tracks by why they cannot be imported", () => {
  assert.deepEqual(
    subtitleTrackTraceFields([
      { isText: true, contentUrl: "/api/media/handle-1" },
      { isText: true },
      { isText: false },
      {},
    ]),
    {
      "media.subtitle_stream.count": 4,
      "media.subtitle_track.offered.count": 1,
      "media.subtitle_track.excluded.non_text.count": 2,
      "media.subtitle_track.excluded.missing_url.count": 1,
    },
  );
});
