import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderSessionRecord } from "../session/store.js";
import {
  createCliparrPlexTranscodeSessionId,
  createPreviewPath,
  deriveSelectedSubtitleTrack,
  deriveSubtitleTracks,
  playheadSecondsFromViewOffset,
} from "./plex/playback.js";
import type { PlexSourceContext } from "./plex/shared.js";

function createSession(): ProviderSessionRecord {
  return {
    id: "session-1",
    providerId: "plex",
    providerAccountId: "account-1",
    userToken: "user-token",
    mediaHandles: new Map(),
    createdAt: 0,
    expiresAt: Date.now() + 60_000,
  };
}

function createContext(): PlexSourceContext {
  return {
    sourceId: "source-1",
    baseUrl: "http://plex.local:32400",
    token: "provider-token",
  };
}

function onlyMediaHandle(session: ProviderSessionRecord) {
  assert.equal(session.mediaHandles.size, 1);
  const handle = [...session.mediaHandles.values()][0];
  assert(handle);
  return handle;
}

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
  assert.match(firstPath ?? "", /subtitles=none/);
});

void test("creates a Cliparr-owned Plex transcode session id", () => {
  const firstId = createCliparrPlexTranscodeSessionId("source-1", "plex-session-1");
  const secondId = createCliparrPlexTranscodeSessionId("source-1", "plex-session-1");
  const differentPlaybackId = createCliparrPlexTranscodeSessionId("source-1", "plex-session-2");
  const differentSourceId = createCliparrPlexTranscodeSessionId("source-2", "plex-session-1");

  assert.equal(firstId, secondId);
  assert.notEqual(firstId, differentPlaybackId);
  assert.notEqual(firstId, differentSourceId);
  assert.match(firstId, /^cliparr-source-1-[a-f0-9]{16}$/);
});

void test("does not create Plex HLS preview paths for audio tracks", () => {
  const item = {
    type: "track",
    ratingKey: "12345",
  };

  assert.equal(createPreviewPath(item, "plex-session-1"), undefined);
});

void test("converts Plex viewOffset milliseconds into playhead seconds", () => {
  assert.equal(playheadSecondsFromViewOffset(123456), 123.456);
  assert.equal(playheadSecondsFromViewOffset("123456"), 123.456);
  assert.equal(playheadSecondsFromViewOffset(0), 0);
  assert.equal(playheadSecondsFromViewOffset(-1), undefined);
  assert.equal(playheadSecondsFromViewOffset(null), undefined);
  assert.equal(playheadSecondsFromViewOffset(undefined), undefined);
  assert.equal(playheadSecondsFromViewOffset("nope"), undefined);
});

void test("creates a direct content URL for Plex sidecar text subtitle streams", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    ratingKey: "12345",
    Media: [{
      id: "media-1",
      selected: 1,
      Part: [{
        id: "part-1",
        selected: 1,
        Stream: [{
          id: "101",
          streamType: 3,
          codec: "subrip",
          languageCode: "eng",
          key: "/library/streams/101",
        }],
      }],
    }],
  };

  const tracks = deriveSubtitleTracks(session, context, item, "plex-session-1");

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.contentUrl, "/api/media/" + onlyMediaHandle(session).id);
  assert.equal(tracks[0]?.contentFormat, "srt");
  assert.equal(onlyMediaHandle(session).path, "/library/streams/101.srt");
});

void test("creates a subtitle transcode content URL for the selected embedded Plex text subtitle", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    ratingKey: "12345",
    Media: [{
      id: "media-1",
      selected: 1,
      Part: [{
        id: "part-1",
        selected: 1,
        Stream: [{
          id: "201",
          index: 2,
          streamType: 3,
          codec: "subrip",
          languageCode: "eng",
          selected: true,
        }],
      }],
    }],
  };

  const tracks = deriveSubtitleTracks(session, context, item, "plex-session-1");
  const handle = onlyMediaHandle(session);
  const transcodeUrl = new URL(handle.path, "http://cliparr.local");

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.contentUrl, `/api/media/${handle.id}`);
  assert.equal(tracks[0]?.contentFormat, "srt");
  assert.equal(handle.path.startsWith("/video/:/transcode/universal/subtitles?"), true);
  assert.equal(transcodeUrl.searchParams.get("path"), "/library/metadata/12345");
  assert.equal(transcodeUrl.searchParams.get("transcodeSessionId"), "plex-session-1");
  assert.equal(transcodeUrl.searchParams.get("mediaIndex"), "0");
  assert.equal(transcodeUrl.searchParams.get("partIndex"), "0");
  assert.equal(transcodeUrl.searchParams.get("subtitles"), "sidecar");
  assert.equal(transcodeUrl.searchParams.get("advancedSubtitles"), "text");
  assert.equal(transcodeUrl.searchParams.get("autoAdjustSubtitle"), "0");
});

void test("prefers direct raw SRT for the selected external Plex text subtitle", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    ratingKey: "12345",
    Media: [{
      id: "media-1",
      selected: 1,
      Part: [{
        id: "part-1",
        selected: 1,
        Stream: [{
          id: "202",
          index: 3,
          streamType: 3,
          codec: "srt",
          languageCode: "eng",
          key: "/library/streams/202",
          selected: true,
        }],
      }],
    }],
  };

  const tracks = deriveSubtitleTracks(session, context, item, "plex-session-1");
  const handle = onlyMediaHandle(session);

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.isExternal, true);
  assert.equal(tracks[0]?.contentUrl, `/api/media/${handle.id}`);
  assert.equal(tracks[0]?.contentFormat, "srt");
  assert.equal(handle.path, "/library/streams/202.srt");
});

void test("reports selected external Plex SRT content format consistently", () => {
  const item = {
    ratingKey: "12345",
    Media: [{
      id: "media-1",
      selected: 1,
      Part: [{
        id: "part-1",
        selected: 1,
        Stream: [{
          id: "203",
          index: 3,
          streamType: 3,
          codec: "subrip",
          languageCode: "eng",
          key: "/library/streams/203",
          selected: true,
        }],
      }],
    }],
  };

  const selectedTrack = deriveSelectedSubtitleTrack(item);

  assert.equal(selectedTrack?.contentFormat, "srt");
});

void test("reports selected embedded Plex text subtitle transcode format", () => {
  const item = {
    ratingKey: "12345",
    Media: [{
      id: "media-1",
      selected: 1,
      Part: [{
        id: "part-1",
        selected: 1,
        Stream: [{
          id: "204",
          index: 4,
          streamType: 3,
          codec: "srt",
          languageCode: "eng",
          selected: true,
        }],
      }],
    }],
  };

  const selectedTrack = deriveSelectedSubtitleTrack(item);

  assert.equal(selectedTrack?.contentFormat, "srt");
});

void test("leaves unselected embedded Plex text subtitles visible but unsupported", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    ratingKey: "12345",
    Media: [{
      id: "media-1",
      selected: 1,
      Part: [{
        id: "part-1",
        selected: 1,
        Stream: [{
          id: "301",
          index: 3,
          streamType: 3,
          codec: "srt",
          languageCode: "eng",
        }],
      }],
    }],
  };

  const tracks = deriveSubtitleTracks(session, context, item, "plex-session-1");

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.isText, true);
  assert.equal(tracks[0]?.contentUrl, undefined);
  assert.equal(session.mediaHandles.size, 0);
});

void test("leaves Plex image subtitle streams unsupported for burn-in", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    ratingKey: "12345",
    Media: [{
      id: "media-1",
      selected: 1,
      Part: [{
        id: "part-1",
        selected: 1,
        Stream: [{
          id: "401",
          index: 4,
          streamType: 3,
          codec: "pgs",
          languageCode: "eng",
          selected: true,
        }],
      }],
    }],
  };

  const tracks = deriveSubtitleTracks(session, context, item, "plex-session-1");

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.isText, false);
  assert.equal(tracks[0]?.contentUrl, undefined);
  assert.equal(session.mediaHandles.size, 0);
});
