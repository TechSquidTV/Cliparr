import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import type { MediaSource } from "../db/mediaSourcesRepository.js";
import type { ProviderSessionRecord } from "../session/store.js";
import {
  buildPreviewPath,
  deriveSelectedSubtitleTrack,
  deriveSubtitleTracks,
  listCurrentlyPlaying,
  playheadSecondsFromPositionTicks,
  proxyMedia,
} from "./jellyfin/playback.js";
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

function createSource(): MediaSource {
  return {
    id: "source-1",
    providerId: "jellyfin",
    providerAccountId: "account-1",
    name: "Jellyfin",
    enabled: true,
    baseUrl: "http://jellyfin.local:8096",
    connection: {},
    credentials: {
      accessToken: "provider-token",
      userId: "user-1",
      deviceId: "cliparr-device-1",
    },
    metadata: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function onlyMediaHandle(session: ProviderSessionRecord) {
  assert.equal(session.mediaHandles.size, 1);
  const handle = [...session.mediaHandles.values()][0];
  assert(handle);
  return handle;
}

function createRequest(headers: Record<string, string> = {}) {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as Pick<Request, "header">;
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: new Map<string, string>(),
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number) {
      this.headers.set(name.toLowerCase(), String(value));
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function fetchInputUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") {
    return new URL(input);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input.url);
}

function createJellyfinPlaybackFetch(options: {
  itemId: string;
  playSessionId?: string | null;
  clientSessionId?: string;
  mediaSourceId?: string;
  title?: string;
}) {
  const {
    itemId,
    playSessionId = "playback-info-session-1",
    clientSessionId = "client-session-1",
    mediaSourceId = "media-source-1",
    title = "Chapter 1: The Dark Revenge",
  } = options;
  const mediaSource = {
    Id: mediaSourceId,
    DefaultAudioStreamIndex: 1,
    MediaStreams: [
      {
        Type: "Video",
        Index: 0,
        Codec: "h264",
        Width: 1920,
        Height: 1080,
      },
      {
        Type: "Audio",
        Index: 1,
        Codec: "aac",
        Language: "eng",
        Title: "English",
        IsDefault: true,
      },
    ],
  };
  const item = {
    Id: itemId,
    Name: title,
    Type: "Episode",
    MediaType: "Video",
    RunTimeTicks: 1_698_000_0000,
    MediaSources: [
      {
        Id: "stale-session-media-source",
        MediaStreams: [],
      },
    ],
  };

  return (async (input) => {
    const url = fetchInputUrl(input);

    if (url.pathname === "/Sessions") {
      return jsonResponse([
        {
          Id: clientSessionId,
          UserId: "user-1",
          UserName: "Rick",
          DeviceName: "Chrome",
          PlayState: {
            MediaSourceId: mediaSourceId,
            IsPaused: true,
            AudioStreamIndex: 1,
            PositionTicks: 1_234_560_000,
          },
          NowPlayingItem: item,
        },
      ]);
    }

    if (url.pathname === `/Items/${itemId}`) {
      return jsonResponse(item);
    }

    if (url.pathname === `/Items/${itemId}/PlaybackInfo`) {
      return jsonResponse({
        ...(playSessionId ? { PlaySessionId: playSessionId } : {}),
        MediaSources: [mediaSource],
      });
    }

    return jsonResponse({ message: `Unexpected URL: ${url.toString()}` }, 404);
  }) as typeof fetch;
}

void test("disables Jellyfin subtitle burn-in on HLS previews", () => {
  const path = buildPreviewPath(
    { Id: "item-1", MediaType: "Video" },
    "media-source-1",
    createContext(),
    "play-session-1",
  );
  assert(path);

  const url = new URL(path, "http://cliparr.local");

  assert.equal(url.pathname, "/Videos/item-1/master.m3u8");
  assert.equal(url.searchParams.get("mediaSourceId"), "media-source-1");
  assert.equal(url.searchParams.get("deviceId"), "cliparr-device-1");
  assert.equal(url.searchParams.get("playSessionId"), "play-session-1");
  assert.equal(
    url.searchParams.get("alwaysBurnInSubtitleWhenTranscoding"),
    "false",
  );
  assert.equal(url.searchParams.has("subtitleStreamIndex"), false);
});

void test("converts Jellyfin PositionTicks into playhead seconds", () => {
  assert.equal(playheadSecondsFromPositionTicks(1234560000), 123.456);
  assert.equal(playheadSecondsFromPositionTicks(0), 0);
  assert.equal(playheadSecondsFromPositionTicks(-1), undefined);
  assert.equal(playheadSecondsFromPositionTicks(null), undefined);
  assert.equal(playheadSecondsFromPositionTicks(undefined), undefined);
});

void test("uses Jellyfin PlaybackInfo play session ids for currently playing streams", async () => {
  const session = createSession();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createJellyfinPlaybackFetch({
    itemId: "item-1",
    playSessionId: "playback-info-session-1",
    clientSessionId: "client-session-1",
  });

  try {
    const entries = await listCurrentlyPlaying(session, createSource());

    assert.equal(entries.length, 1);
    assert.equal(
      entries[0]?.item.id,
      "source-1:client-session-1:item-1:media-source-1",
    );
    assert.equal(entries[0]?.item.playheadSeconds, 123.456);
    assert(entries[0]?.item.mediaUrl);
    assert(entries[0]?.item.hlsUrl);

    const streamHandle = [...session.mediaHandles.values()].find((handle) =>
      handle.path.includes("/stream?"),
    );
    const hlsHandle = [...session.mediaHandles.values()].find((handle) =>
      handle.path.includes("/master.m3u8?"),
    );
    assert(streamHandle);
    assert(hlsHandle);

    const streamUrl = new URL(streamHandle.path, "http://cliparr.local");
    const hlsUrl = new URL(hlsHandle.path, "http://cliparr.local");
    assert.equal(
      streamUrl.searchParams.get("playSessionId"),
      "playback-info-session-1",
    );
    assert.equal(
      hlsUrl.searchParams.get("playSessionId"),
      "playback-info-session-1",
    );
    assert.notEqual(
      streamUrl.searchParams.get("playSessionId"),
      "client-session-1",
    );
    assert.notEqual(
      hlsUrl.searchParams.get("playSessionId"),
      "client-session-1",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("keeps Jellyfin currently playing item ids stable and item-scoped", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = createJellyfinPlaybackFetch({
      itemId: "item-1",
      clientSessionId: "client-session-1",
    });
    const firstEntries = await listCurrentlyPlaying(
      createSession(),
      createSource(),
    );
    const secondEntries = await listCurrentlyPlaying(
      createSession(),
      createSource(),
    );

    globalThis.fetch = createJellyfinPlaybackFetch({
      itemId: "item-2",
      clientSessionId: "client-session-1",
    });
    const differentItemEntries = await listCurrentlyPlaying(
      createSession(),
      createSource(),
    );

    assert.equal(firstEntries[0]?.item.id, secondEntries[0]?.item.id);
    assert.notEqual(firstEntries[0]?.item.id, differentItemEntries[0]?.item.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("omits Jellyfin stream URLs when PlaybackInfo has no play session id", async () => {
  const session = createSession();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createJellyfinPlaybackFetch({
    itemId: "item-1",
    playSessionId: null,
    clientSessionId: "client-session-1",
  });

  try {
    const entries = await listCurrentlyPlaying(session, createSource());

    assert.equal(entries.length, 1);
    assert.equal(
      entries[0]?.item.id,
      "source-1:client-session-1:item-1:media-source-1",
    );
    assert.equal(entries[0]?.item.mediaUrl, undefined);
    assert.equal(entries[0]?.item.hlsUrl, undefined);
    assert.equal(entries[0]?.item.previewUrl, undefined);
    assert.equal(entries[0]?.item.previewFormat, undefined);
    assert.equal(session.mediaHandles.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("creates a downloadable content URL for Jellyfin text subtitle streams", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    Id: "item-1",
    MediaSources: [
      {
        Id: "media-source-1",
        MediaStreams: [
          {
            Type: "Subtitle",
            Index: 2,
            Codec: "srt",
            Language: "eng",
            Title: "English",
            IsTextSubtitleStream: true,
            IsExternal: true,
            IsForced: true,
            IsHearingImpaired: true,
          },
        ],
      },
    ],
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
  assert.equal(
    handle.path,
    "/Videos/item-1/media-source-1/Subtitles/2/Stream.vtt",
  );
});

void test("uses Jellyfin session media sources for subtitle track discovery", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    Id: "item-1",
    MediaSources: [],
  };
  const sessionInfo = {
    NowPlayingItem: {
      MediaSources: [
        {
          Id: "session-media-source-1",
          MediaStreams: [
            {
              Type: "Subtitle",
              Index: 5,
              Codec: "srt",
              Language: "eng",
              Title: "Session English",
              IsTextSubtitleStream: true,
            },
          ],
        },
      ],
    },
  };

  const tracks = deriveSubtitleTracks(
    session,
    context,
    item,
    "session-media-source-1",
    sessionInfo,
  );
  const handle = onlyMediaHandle(session);

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.streamId, "5");
  assert.equal(tracks[0]?.title, "Session English");
  assert.equal(tracks[0]?.contentUrl, `/api/media/${handle.id}`);
  assert.equal(
    handle.path,
    "/Videos/item-1/session-media-source-1/Subtitles/5/Stream.vtt",
  );
});

void test("uses resolved Jellyfin media source id for subtitle content URLs", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    Id: "item-1",
    MediaSources: [
      {
        Id: "resolved-media-source-1",
        MediaStreams: [
          {
            Type: "Subtitle",
            Index: 6,
            Codec: "srt",
            Language: "eng",
            Title: "Resolved English",
            IsTextSubtitleStream: true,
          },
        ],
      },
    ],
  };

  const tracks = deriveSubtitleTracks(session, context, item, undefined);
  const handle = onlyMediaHandle(session);

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.streamId, "6");
  assert.equal(tracks[0]?.contentUrl, `/api/media/${handle.id}`);
  assert.equal(
    handle.path,
    "/Videos/item-1/resolved-media-source-1/Subtitles/6/Stream.vtt",
  );
});

void test("uses Jellyfin PlayState subtitle stream index for selected subtitle matching", () => {
  const item = {
    Id: "item-1",
    MediaSources: [
      {
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
      },
    ],
  };
  const sessionInfo = {
    PlayState: {
      MediaSourceId: "media-source-1",
      SubtitleStreamIndex: 4,
    },
  };

  const selectedSubtitleTrack = deriveSelectedSubtitleTrack(
    sessionInfo,
    item,
    "media-source-1",
  );

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
    MediaSources: [
      {
        Id: "media-source-1",
        MediaStreams: [
          {
            Type: "Subtitle",
            Index: 3,
            Codec: "pgs",
            Language: "eng",
            Title: "English PGS",
            IsTextSubtitleStream: false,
          },
        ],
      },
    ],
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

void test("strips Jellyfin auth headers from cross-origin media redirects", async () => {
  const session = createSession();
  session.mediaHandles.set("handle-1", {
    id: "handle-1",
    providerId: "jellyfin",
    sourceId: "source-1",
    baseUrl: "http://jellyfin.local:8096",
    path: "/Videos/item-1/stream",
    token: "provider-token",
    deviceId: "cliparr-device-1",
    lastAccessedAt: 0,
  });

  const originalFetch = globalThis.fetch;
  const requestHeaders: Headers[] = [];

  globalThis.fetch = (async (_input, init) => {
    requestHeaders.push(new Headers(init?.headers));
    if (requestHeaders.length === 1) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "http://1.1.1.1/video.mp4",
        },
      });
    }

    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const response = createResponseRecorder();
    await proxyMedia(
      session,
      "handle-1",
      createRequest({ accept: "video/mp4" }) as Request,
      response as unknown as Response,
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.ended, true);
    assert.match(
      requestHeaders[0]?.get("authorization") ?? "",
      /Token="provider-token"/,
    );
    assert.equal(requestHeaders[1]?.get("authorization"), null);
    assert.equal(requestHeaders[1]?.get("accept"), "video/mp4");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
