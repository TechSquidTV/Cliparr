import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderSessionRecord } from "../session/store.js";
import { buildPreviewPath, deriveSelectedSubtitleTrack, deriveSubtitleTracks } from "./jellyfin/playback.js";
import type { JellyfinSourceContext } from "./jellyfin/shared.js";

function createSession(): ProviderSessionRecord {
  return {
    id: "session-1",
    providerId: "jellyfin",
    providerAccountId: "account-1",
    userToken: "user-token",
    mediaHandles: new Map(),
    createdAt: 0,
    expiresAt: Date.now() + 60_000,
  };
}

function createContext(): JellyfinSourceContext {
  return {
    sourceId: "source-1",
    baseUrl: "http://jellyfin.local:8096",
    token: "provider-token",
    userId: "user-1",
    deviceId: "cliparr-device-1",
  };
}

function onlyMediaHandle(session: ProviderSessionRecord) {
  assert.equal(session.mediaHandles.size, 1);
  const handle = [...session.mediaHandles.values()][0];
  assert(handle);
  return handle;
}

void test("disables Jellyfin subtitle burn-in on HLS previews", () => {
  const path = buildPreviewPath(
    { Id: "item-1", MediaType: "Video" },
    "media-source-1",
    createContext(),
    "play-session-1"
  );
  assert(path);

  const url = new URL(path, "http://cliparr.local");

  assert.equal(url.pathname, "/Videos/item-1/master.m3u8");
  assert.equal(url.searchParams.get("mediaSourceId"), "media-source-1");
  assert.equal(url.searchParams.get("deviceId"), "cliparr-device-1");
  assert.equal(url.searchParams.get("playSessionId"), "play-session-1");
  assert.equal(url.searchParams.get("alwaysBurnInSubtitleWhenTranscoding"), "false");
  assert.equal(url.searchParams.has("subtitleStreamIndex"), false);
});

void test("creates a downloadable content URL for Jellyfin text subtitle streams", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    Id: "item-1",
    MediaSources: [{
      Id: "media-source-1",
      MediaStreams: [{
        Type: "Subtitle",
        Index: 2,
        Codec: "srt",
        Language: "eng",
        Title: "English",
        IsTextSubtitleStream: true,
        IsExternal: true,
        IsForced: true,
        IsHearingImpaired: true,
      }],
    }],
  };

  const tracks = deriveSubtitleTracks(session, context, item, "media-source-1");
  const handle = onlyMediaHandle(session);

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.streamId, "2");
  assert.equal(tracks[0]?.contentUrl, `/api/media/${handle.id}`);
  assert.equal(tracks[0]?.contentFormat, "vtt");
  assert.equal(tracks[0]?.isText, true);
  assert.equal(tracks[0]?.isExternal, true);
  assert.equal(tracks[0]?.isForced, true);
  assert.equal(tracks[0]?.isHearingImpaired, true);
  assert.equal(handle.path, "/Videos/item-1/media-source-1/Subtitles/2/Stream.vtt");
});

void test("uses Jellyfin PlayState subtitle stream index for selected subtitle matching", () => {
  const item = {
    Id: "item-1",
    MediaSources: [{
      Id: "media-source-1",
      MediaStreams: [
        {
          Type: "Subtitle",
          Index: 2,
          Codec: "srt",
          Language: "eng",
          Title: "English",
          IsTextSubtitleStream: true,
        },
        {
          Type: "Subtitle",
          Index: 4,
          Codec: "vtt",
          Language: "spa",
          Title: "Spanish",
          IsTextSubtitleStream: true,
        },
      ],
    }],
  };
  const sessionInfo = {
    PlayState: {
      MediaSourceId: "media-source-1",
      SubtitleStreamIndex: 4,
    },
  };

  const selectedSubtitleTrack = deriveSelectedSubtitleTrack(sessionInfo, item, "media-source-1");

  assert.equal(selectedSubtitleTrack?.streamId, "4");
  assert.equal(selectedSubtitleTrack?.index, 4);
  assert.equal(selectedSubtitleTrack?.languageCode, "spa");
  assert.equal(selectedSubtitleTrack?.title, "Spanish");
  assert.equal(selectedSubtitleTrack?.codec, "vtt");
  assert.equal(selectedSubtitleTrack?.contentFormat, "vtt");
  assert.equal(selectedSubtitleTrack?.isText, true);
});

void test("leaves Jellyfin image subtitle streams visible but unsupported for burn-in", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    Id: "item-1",
    MediaSources: [{
      Id: "media-source-1",
      MediaStreams: [{
        Type: "Subtitle",
        Index: 3,
        Codec: "pgs",
        Language: "eng",
        Title: "English PGS",
        IsTextSubtitleStream: false,
      }],
    }],
  };

  const tracks = deriveSubtitleTracks(session, context, item, "media-source-1");

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.streamId, "3");
  assert.equal(tracks[0]?.codec, "pgs");
  assert.equal(tracks[0]?.isText, false);
  assert.equal(tracks[0]?.contentUrl, undefined);
  assert.equal(tracks[0]?.contentFormat, undefined);
  assert.equal(session.mediaHandles.size, 0);
});

