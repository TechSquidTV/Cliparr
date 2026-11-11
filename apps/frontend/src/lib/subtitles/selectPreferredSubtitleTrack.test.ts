import assert from "node:assert/strict";
import test from "node:test";

import {
  type PlaybackSubtitleTrack,
  subtitleTrackSupportsBurnIn,
} from "@cliparr/shared/providers";

import {
  selectPreferredSubtitleTrack,
  subtitleTrackUnavailableMessage,
} from "#/lib/subtitles/selectPreferredSubtitleTrack";

const textTrack: PlaybackSubtitleTrack = {
  streamId: "2",
  index: 2,
  codec: "subrip",
  isText: true,
  contentUrl: "/api/media/handle-1",
};
const imageTrack: PlaybackSubtitleTrack = {
  streamId: "3",
  index: 3,
  codec: "pgssub",
  isText: false,
};

void test("explains why a reported subtitle track cannot be imported", () => {
  assert.equal(
    subtitleTrackUnavailableMessage(textTrack, "jellyfin"),
    undefined,
  );
  assert.equal(
    subtitleTrackUnavailableMessage(imageTrack, "jellyfin"),
    "Image-based subtitles cannot be imported. Only text tracks are supported.",
  );
  assert.equal(
    subtitleTrackUnavailableMessage(
      { ...textTrack, contentUrl: undefined },
      "jellyfin",
    ),
    "This provider cannot download this subtitle track.",
  );
  assert.equal(
    subtitleTrackUnavailableMessage(
      { ...textTrack, contentUrl: undefined },
      "plex",
    ),
    "Select this embedded subtitle in Plex first.",
  );
});

void test("never imports an image track the viewer selected in the provider", () => {
  const importable = [imageTrack, textTrack].filter((track) =>
    subtitleTrackSupportsBurnIn(track),
  );
  assert.deepEqual(importable, [textTrack]);
  assert.equal(
    selectPreferredSubtitleTrack(importable, { streamId: "3", index: 3 }),
    textTrack,
  );
  assert.equal(selectPreferredSubtitleTrack([], { streamId: "3" }), null);
});
