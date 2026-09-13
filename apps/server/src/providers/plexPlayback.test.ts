import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import type { MediaSource } from "@/db/mediaSourcesRepository";
import type { ProviderSessionRecord } from "@/session/store";
import {
  createPlexExportEstimateMetadata,
  createCliparrPlexTranscodeSessionId,
  createPlexViewerAvatarUrl,
  createPreviewPath,
  deriveSelectedSubtitleTrack,
  deriveSubtitleTracks,
  listCurrentlyPlaying,
  playheadSecondsFromViewOffset,
  proxyMedia,
} from "@/providers/plex/playback";
import type { PlexSourceContext } from "@/providers/plex/shared";

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

function createSource(): MediaSource {
  return {
    id: "source-1",
    providerId: "plex",
    providerAccountId: "account-1",
    name: "Plex",
    enabled: true,
    baseUrl: "http://plex.local:32400",
    connection: {
      baseUrlMode: "manual",
      connections: [
        {
          id: "plex-connection-1",
          uri: "http://plex.local:32400",
          local: true,
          relay: false,
          protocol: "http",
          address: "plex.local",
          port: 32_400,
        },
      ],
      selectedConnectionId: "plex-connection-1",
    },
    credentials: {
      accessToken: "provider-token",
    },
    metadata: {
      owned: true,
      provides: ["server"],
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  return globalThis.Response.json(body, {
    ...init,
    headers,
  });
}

function withMockFetch(
  handler: (
    request: globalThis.Request,
  ) => globalThis.Response | Promise<globalThis.Response>,
  callback: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    return handler(new globalThis.Request(input, init));
  }) as typeof fetch;

  return callback().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function mediaHandleForUrl(
  session: ProviderSessionRecord,
  mediaUrl: string | undefined,
) {
  assert.ok(mediaUrl);
  const handleId = mediaUrl.split("/").at(-1);
  assert.ok(handleId);
  const handle = session.mediaHandles.get(handleId);
  assert.ok(handle);
  return handle;
}

function createRequest(headers: Record<string, string> = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );

  return {
    header(name: string) {
      return normalizedHeaders.get(name.toLowerCase());
    },
  };
}

function createResponseRecorder() {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const recorder = Object.assign(stream, {
    statusCode: 200,
    headers: new Map<string, string>(),
    status(code: number) {
      recorder.statusCode = code;
      return recorder;
    },
    setHeader(name: string, value: string | number) {
      recorder.headers.set(name.toLowerCase(), String(value));
      return recorder;
    },
  });

  const response = Object.assign(recorder, {
    getBody: () => Buffer.concat(chunks).toString(),
  });
  return response as typeof response & ExpressResponse;
}

function onlyMediaHandle(session: ProviderSessionRecord) {
  assert.equal(session.mediaHandles.size, 1);
  const handle = [...session.mediaHandles.values()][0];
  assert.ok(handle);
  return handle;
}

void test("uses a stable Plex transcode session id for repeated playback polls", () => {
  const item = {
    ratingKey: "12345",
    Media: [
      {
        id: "media-1",
        selected: 1,
        Part: [
          {
            id: "part-1",
            selected: 1,
          },
        ],
      },
    ],
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
  const firstId = createCliparrPlexTranscodeSessionId(
    "source-1",
    "plex-session-1",
  );
  const secondId = createCliparrPlexTranscodeSessionId(
    "source-1",
    "plex-session-1",
  );
  const differentPlaybackId = createCliparrPlexTranscodeSessionId(
    "source-1",
    "plex-session-2",
  );
  const differentSourceId = createCliparrPlexTranscodeSessionId(
    "source-2",
    "plex-session-1",
  );

  assert.equal(firstId, secondId);
  assert.notEqual(firstId, differentPlaybackId);
  assert.notEqual(firstId, differentSourceId);
  assert.notEqual(firstId, "plex-session-1");
  assert.match(
    firstId,
    /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
  );
});

void test("isolates Plex subtitle extraction from the viewer and HLS preview sessions", () => {
  const session = createSession();
  const context = createContext();
  const plexPlaybackSessionId = "254";
  const cliparrPreviewTranscodeSessionId = createCliparrPlexTranscodeSessionId(
    context.sourceId,
    plexPlaybackSessionId,
  );
  const item = {
    ratingKey: "14447",
    Media: [
      {
        id: "19134",
        selected: 1,
        Part: [
          {
            id: "28744",
            selected: 1,
            Stream: [
              {
                id: "101151",
                index: "3",
                streamType: "3",
                codec: "srt",
                languageCode: "eng",
                selected: "1",
                title: "English SDH",
              },
            ],
          },
        ],
      },
    ],
  };

  const previewPath = createPreviewPath(item, cliparrPreviewTranscodeSessionId);
  const previewUrl = new URL(previewPath ?? "", "http://cliparr.local");
  const tracks = deriveSubtitleTracks(
    session,
    context,
    item,
    plexPlaybackSessionId,
  );
  const handle = onlyMediaHandle(session);
  const subtitleUrl = new URL(handle.path, "http://cliparr.local");

  assert.equal(
    previewUrl.searchParams.get("transcodeSessionId"),
    cliparrPreviewTranscodeSessionId,
  );
  assert.equal(previewUrl.searchParams.get("subtitles"), "none");
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.contentUrl, `/api/media/${handle.id}`);
  assert.equal(tracks[0]?.contentFormat, "srt");
  assert.equal(tracks[0]?.streamId, "101151");
  assert.equal(
    handle.providerMetadata?.plex?.playbackSessionId,
    subtitleUrl.searchParams.get("session"),
  );
  assert.notEqual(
    subtitleUrl.searchParams.get("session"),
    plexPlaybackSessionId,
  );
  assert.notEqual(
    subtitleUrl.searchParams.get("session"),
    cliparrPreviewTranscodeSessionId,
  );
  assert.equal(subtitleUrl.searchParams.get("path"), "/library/metadata/14447");
  assert.equal(subtitleUrl.searchParams.get("mediaIndex"), "0");
  assert.equal(subtitleUrl.searchParams.get("partIndex"), "0");
  assert.equal(subtitleUrl.searchParams.get("subtitles"), "sidecar");
});

void test("sends the real Plex playback session header for synthetic HLS preview handles", async () => {
  const session = createSession();
  const context = createContext();
  const plexPlaybackSessionId = "254";
  const cliparrPreviewTranscodeSessionId = createCliparrPlexTranscodeSessionId(
    context.sourceId,
    plexPlaybackSessionId,
  );
  const item = {
    ratingKey: "14447",
    Media: [
      {
        id: "19134",
        selected: 1,
        Part: [
          {
            id: "28744",
            selected: 1,
          },
        ],
      },
    ],
  };
  const previewPath = createPreviewPath(item, cliparrPreviewTranscodeSessionId);
  assert.ok(previewPath);
  const handleId = "hls-handle";
  session.mediaHandles.set(handleId, {
    id: handleId,
    providerId: "plex",
    sourceId: context.sourceId,
    baseUrl: context.baseUrl,
    path: previewPath,
    token: context.token,
    providerMetadata: {
      plex: {
        playbackSessionId: plexPlaybackSessionId,
      },
    },
    lastAccessedAt: 0,
  });
  const requestHeaders: Headers[] = [];
  const requestUrls: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input, init) => {
    requestUrls.push(
      typeof input === "string" || input instanceof URL
        ? input.toString()
        : input.url,
    );
    requestHeaders.push(new Headers(init?.headers));
    return new globalThis.Response("#EXTM3U\n#EXT-X-ENDLIST\n", {
      status: 200,
      headers: {
        "content-type": "application/vnd.apple.mpegurl",
      },
    });
  }) as typeof fetch;

  try {
    const response = createResponseRecorder();
    await proxyMedia(
      session,
      handleId,
      createRequest({ accept: "*/*" }) as ExpressRequest,
      response,
    );

    const upstreamUrl = new URL(requestUrls[0] ?? "");
    assert.equal(
      upstreamUrl.searchParams.get("transcodeSessionId"),
      cliparrPreviewTranscodeSessionId,
    );
    assert.equal(
      requestHeaders[0]?.get("x-plex-session-identifier"),
      plexPlaybackSessionId,
    );
    assert.notEqual(
      requestHeaders[0]?.get("x-plex-session-identifier"),
      cliparrPreviewTranscodeSessionId,
    );
    assert.equal(requestHeaders[0]?.get("x-plex-token"), context.token);
    assert.equal(response.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("builds Plex HLS preview and embedded SRT extraction with independent sessions", async () => {
  const session = createSession();
  const source = createSource();
  const plexPlaybackSessionId = "254";
  const cliparrPreviewTranscodeSessionId = createCliparrPlexTranscodeSessionId(
    source.id,
    plexPlaybackSessionId,
  );
  const currentItem = {
    ratingKey: "14447",
    key: "/library/metadata/14447",
    sessionKey: plexPlaybackSessionId,
    type: "episode",
    title: "The Plex Subtitle Case",
    duration: 1_800_000,
    viewOffset: 120_000,
    User: {
      id: "user-1",
      title: "Rick",
    },
    Player: {
      title: "Chrome",
      state: "playing",
    },
  };
  const metadataItem = {
    ratingKey: "14447",
    key: "/library/metadata/14447",
    type: "episode",
    title: "The Plex Subtitle Case",
    duration: 1_800_000,
    Media: [
      {
        id: "19134",
        selected: 1,
        Part: [
          {
            id: "28744",
            selected: 1,
            Stream: [
              {
                id: "101149",
                streamType: 1,
                codec: "h264",
                width: 1920,
                height: 1080,
                selected: 1,
              },
              {
                id: "101150",
                streamType: 2,
                codec: "aac",
                languageCode: "eng",
                selected: 1,
              },
              {
                id: "101151",
                index: "3",
                streamType: "3",
                codec: "srt",
                languageCode: "eng",
                selected: "1",
                title: "English SDH",
              },
            ],
          },
        ],
      },
    ],
  };

  await withMockFetch(
    (request) => {
      if (request.url === "http://plex.local:32400/status/sessions") {
        return jsonResponse({
          MediaContainer: {
            Metadata: [currentItem],
          },
        });
      }

      if (request.url === "http://plex.local:32400/library/metadata/14447") {
        return jsonResponse({
          MediaContainer: {
            Metadata: [metadataItem],
          },
        });
      }

      throw new Error(`Unexpected request: ${request.url}`);
    },
    async () => {
      const entries = await listCurrentlyPlaying(session, source);
      assert.equal(entries.length, 1);

      const item = entries[0]?.item;
      assert.ok(item);
      assert.equal(item.previewFormat, "hls");
      assert.equal(item.selectedSubtitleTrack?.streamId, "101151");
      assert.equal(item.selectedSubtitleTrack?.contentFormat, "srt");
      const subtitleTracks = item.subtitleTracks ?? [];
      assert.equal(subtitleTracks.length, 1);

      const hlsHandle = mediaHandleForUrl(session, item.hlsUrl);
      const hlsUrl = new URL(hlsHandle.path, "http://cliparr.local");
      assert.equal(
        hlsUrl.searchParams.get("transcodeSessionId"),
        cliparrPreviewTranscodeSessionId,
      );
      assert.equal(hlsUrl.searchParams.get("subtitles"), "none");
      assert.equal(
        hlsHandle.providerMetadata?.plex?.playbackSessionId,
        plexPlaybackSessionId,
      );

      const subtitleTrack = subtitleTracks[0];
      assert.ok(subtitleTrack);
      assert.equal(subtitleTrack.contentFormat, "srt");
      assert.equal(subtitleTrack.streamId, "101151");

      const subtitleHandle = mediaHandleForUrl(
        session,
        subtitleTrack.contentUrl,
      );
      const subtitleUrl = new URL(subtitleHandle.path, "http://cliparr.local");
      assert.notEqual(
        subtitleUrl.searchParams.get("session"),
        plexPlaybackSessionId,
      );
      assert.notEqual(
        subtitleUrl.searchParams.get("session"),
        cliparrPreviewTranscodeSessionId,
      );
      assert.equal(subtitleUrl.searchParams.get("subtitles"), "sidecar");
      assert.equal(
        subtitleUrl.searchParams.get("path"),
        "/library/metadata/14447",
      );
      assert.equal(
        subtitleHandle.providerMetadata?.plex?.playbackSessionId,
        subtitleUrl.searchParams.get("session"),
      );
    },
  );
});

void test("does not create Plex HLS preview paths for audio tracks", () => {
  const item = {
    type: "track",
    ratingKey: "12345",
  };

  assert.equal(createPreviewPath(item, "plex-session-1"), undefined);
});

void test("converts Plex viewOffset milliseconds into playhead seconds", () => {
  assert.equal(playheadSecondsFromViewOffset(123_456), 123.456);
  assert.equal(playheadSecondsFromViewOffset("123456"), 123.456);
  assert.equal(playheadSecondsFromViewOffset(0), 0);
  assert.equal(playheadSecondsFromViewOffset(-1), undefined);
  assert.equal(playheadSecondsFromViewOffset(null), undefined);
  assert.equal(playheadSecondsFromViewOffset(), undefined);
  assert.equal(playheadSecondsFromViewOffset("nope"), undefined);
});

void test("extracts Plex export size estimate metadata from selected media", () => {
  const item = {
    duration: 600_000,
    Media: [
      {
        id: "media-1",
        bitrate: 1600,
        width: 1920,
        height: 1080,
        selected: 1,
        Part: [
          {
            id: "part-1",
            selected: 1,
            size: 120_000_000,
            duration: 600_000,
            Stream: [
              {
                id: "video-1",
                streamType: 1,
                codec: "h264",
                width: 1920,
                height: 1080,
                bitrate: 1400,
                frameRate: 23.976,
                selected: 1,
              },
              {
                id: "audio-1",
                streamType: 2,
                bitrate: 160,
                selected: 1,
              },
            ],
          },
        ],
      },
    ],
  };

  assert.deepEqual(createPlexExportEstimateMetadata(item, undefined, 600), {
    sourceSizeBytes: 120_000_000,
    sourceDurationSeconds: 600,
    sourceBitrateKbps: 1600,
    videoBitrateKbps: 1400,
    audioBitrateKbps: 160,
    videoCodec: "avc",
    width: 1920,
    height: 1080,
    frameRate: 23.976,
  });
});

void test("creates a direct content URL for Plex sidecar text subtitle streams", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    ratingKey: "12345",
    Media: [
      {
        id: "media-1",
        selected: 1,
        Part: [
          {
            id: "part-1",
            selected: 1,
            Stream: [
              {
                id: "101",
                streamType: 3,
                codec: "subrip",
                languageCode: "eng",
                key: "/library/streams/101",
              },
            ],
          },
        ],
      },
    ],
  };

  const tracks = deriveSubtitleTracks(session, context, item, "plex-session-1");

  assert.equal(tracks.length, 1);
  assert.equal(
    tracks[0]?.contentUrl,
    `/api/media/${onlyMediaHandle(session).id}`,
  );
  assert.equal(tracks[0]?.contentFormat, "srt");
  assert.equal(onlyMediaHandle(session).path, "/library/streams/101.srt");
});

void test("proxies Plex viewer avatar URLs through provider media handles", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    User: {
      id: "user-1",
      title: "Alice",
      thumb: "https://plex.tv/users/user-1/avatar?c=123",
    },
  };

  const avatarUrl = createPlexViewerAvatarUrl(session, context, item);
  const handle = onlyMediaHandle(session);

  assert.equal(avatarUrl, `/api/media/${handle.id}`);
  assert.equal(handle.path, "https://plex.tv/users/user-1/avatar?c=123");
});

void test("creates a subtitle transcode content URL for the selected embedded Plex text subtitle", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    ratingKey: "12345",
    Media: [
      {
        id: "media-1",
        selected: 1,
        Part: [
          {
            id: "part-1",
            selected: 1,
            Stream: [
              {
                id: "201",
                index: 2,
                streamType: 3,
                codec: "subrip",
                languageCode: "eng",
                selected: true,
              },
            ],
          },
        ],
      },
    ],
  };

  const tracks = deriveSubtitleTracks(session, context, item, "plex-session-1");
  const handle = onlyMediaHandle(session);
  const transcodeUrl = new URL(handle.path, "http://cliparr.local");

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.contentUrl, `/api/media/${handle.id}`);
  assert.equal(tracks[0]?.contentFormat, "srt");
  assert.equal(
    handle.path.startsWith("/subtitles/:/transcode/universal/start?"),
    true,
  );
  assert.equal(
    transcodeUrl.searchParams.get("path"),
    "/library/metadata/12345",
  );
  assert.ok(transcodeUrl.searchParams.get("session"));
  assert.notEqual(transcodeUrl.searchParams.get("session"), "plex-session-1");
  assert.equal(transcodeUrl.searchParams.has("transcodeSessionId"), false);
  assert.equal(handle.providerMetadata?.plex?.subtitleStreamId, "201");
  assert.equal(transcodeUrl.searchParams.get("protocol"), "http");
  assert.equal(transcodeUrl.searchParams.get("directPlay"), "1");
  assert.equal(transcodeUrl.searchParams.get("hasMDE"), "1");
  assert.equal(transcodeUrl.searchParams.get("offset"), "0");
  assert.equal(transcodeUrl.searchParams.get("copyts"), "1");
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
    Media: [
      {
        id: "media-1",
        selected: 1,
        Part: [
          {
            id: "part-1",
            selected: 1,
            Stream: [
              {
                id: "202",
                index: 3,
                streamType: 3,
                codec: "srt",
                languageCode: "eng",
                key: "/library/streams/202",
                selected: true,
              },
            ],
          },
        ],
      },
    ],
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
    Media: [
      {
        id: "media-1",
        selected: 1,
        Part: [
          {
            id: "part-1",
            selected: 1,
            Stream: [
              {
                id: "203",
                index: 3,
                streamType: 3,
                codec: "subrip",
                languageCode: "eng",
                key: "/library/streams/203",
                selected: true,
              },
            ],
          },
        ],
      },
    ],
  };

  const selectedTrack = deriveSelectedSubtitleTrack(item);

  assert.equal(selectedTrack?.contentFormat, "srt");
});

void test("reports selected embedded Plex text subtitle transcode format", () => {
  const item = {
    ratingKey: "12345",
    Media: [
      {
        id: "media-1",
        selected: 1,
        Part: [
          {
            id: "part-1",
            selected: 1,
            Stream: [
              {
                id: "204",
                index: 4,
                streamType: 3,
                codec: "srt",
                languageCode: "eng",
                selected: true,
              },
            ],
          },
        ],
      },
    ],
  };

  const selectedTrack = deriveSelectedSubtitleTrack(item);

  assert.equal(selectedTrack?.contentFormat, "srt");
});

void test("leaves unselected embedded Plex text subtitles visible but unsupported", () => {
  const session = createSession();
  const context = createContext();
  const item = {
    ratingKey: "12345",
    Media: [
      {
        id: "media-1",
        selected: 1,
        Part: [
          {
            id: "part-1",
            selected: 1,
            Stream: [
              {
                id: "301",
                index: 3,
                streamType: 3,
                codec: "srt",
                languageCode: "eng",
              },
            ],
          },
        ],
      },
    ],
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
    Media: [
      {
        id: "media-1",
        selected: 1,
        Part: [
          {
            id: "part-1",
            selected: 1,
            Stream: [
              {
                id: "401",
                index: 4,
                streamType: 3,
                codec: "pgs",
                languageCode: "eng",
                selected: true,
              },
            ],
          },
        ],
      },
    ],
  };

  const tracks = deriveSubtitleTracks(session, context, item, "plex-session-1");

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.isText, false);
  assert.equal(tracks[0]?.contentUrl, undefined);
  assert.equal(session.mediaHandles.size, 0);
});

function embeddedSubtitleItem(codec = "srt") {
  return {
    ratingKey: "12345",
    Media: [
      {
        Part: [
          {
            Stream: [{ id: "201", streamType: 3, codec, selected: true }],
          },
        ],
      },
    ],
  };
}

void test("prepares a Plex direct-play decision before downloading embedded subtitle text", async () => {
  for (const codec of ["srt", "ass"]) {
    const session = createSession();
    const context = createContext();
    const item = embeddedSubtitleItem(codec);
    deriveSubtitleTracks(session, context, item, "viewer-session");
    const handle = onlyMediaHandle(session);
    const contentUrl = new URL(handle.path, context.baseUrl);
    const requests: string[] = [];
    const subtitleText =
      "1\n00:00:01,023 --> 00:00:03,023\nEmbedded English cue\n";

    await withMockFetch(
      (request) => {
        const url = new URL(request.url);
        requests.push(url.pathname);
        assert.equal(request.method, "GET");
        assert.equal(request.headers.get("x-plex-token"), context.token);
        assert.equal(
          request.headers.get("x-plex-session-identifier"),
          contentUrl.searchParams.get("session"),
        );
        assert.equal(
          request.headers.get("x-plex-client-profile-name"),
          "Generic",
        );
        assert.match(
          request.headers.get("x-plex-client-profile-extra") ?? "",
          /subtitleCodec=srt&container=srt/,
        );
        assert.equal(url.search, contentUrl.search);

        if (url.pathname === "/video/:/transcode/universal/decision") {
          assert.equal(requests.length, 1);
          assert.equal(request.headers.get("accept"), "application/json");
          return jsonResponse({ MediaContainer: { Metadata: [item] } });
        }
        assert.equal(url.pathname, "/subtitles/:/transcode/universal/start");
        assert.equal(requests.length, 2);
        return new globalThis.Response(subtitleText, {
          headers: { "content-type": "application/octet-stream" },
        });
      },
      async () => {
        const response = createResponseRecorder();
        await proxyMedia(
          session,
          handle.id,
          createRequest() as ExpressRequest,
          response,
        );
        assert.equal(response.statusCode, 200);
        assert.equal(response.getBody(), subtitleText);
        assert.equal(requests.length, 2);
      },
    );
  }
});

void test("does not download embedded subtitles when Plex refuses or changes the selection", async () => {
  for (const failure of ["denied", "different-track", "disabled"] as const) {
    const session = createSession();
    const item = embeddedSubtitleItem();
    deriveSubtitleTracks(session, createContext(), item, "viewer-session");
    const handle = onlyMediaHandle(session);
    let requests = 0;

    await withMockFetch(
      (request) => {
        requests += 1;
        assert.equal(
          new URL(request.url).pathname,
          "/video/:/transcode/universal/decision",
        );
        if (failure === "denied") {
          return new globalThis.Response(null, { status: 403 });
        }
        return jsonResponse({
          MediaContainer: {
            Metadata: [
              {
                Media: [
                  {
                    Part: [
                      {
                        Stream: [
                          {
                            id: failure === "different-track" ? "202" : "201",
                            streamType: 3,
                            selected: failure !== "disabled",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        });
      },
      async () => {
        await assert.rejects(
          proxyMedia(
            session,
            handle.id,
            createRequest() as ExpressRequest,
            createResponseRecorder(),
          ),
          {
            code:
              failure === "denied"
                ? "plex_subtitle_decision_failed"
                : "plex_subtitle_selection_changed",
            status: failure === "denied" ? 403 : 409,
          },
        );
        assert.equal(requests, 1);
      },
    );
  }
});

void test("downloads Plex sidecar subtitles without a transcode decision", async () => {
  const session = createSession();
  const item = embeddedSubtitleItem();
  const stream = item.Media[0]?.Part[0]?.Stream[0];
  assert.ok(stream);
  const sidecarItem = {
    ...item,
    Media: [
      { Part: [{ Stream: [{ ...stream, key: "/library/streams/201" }] }] },
    ],
  };
  deriveSubtitleTracks(session, createContext(), sidecarItem, "viewer-session");
  const handle = onlyMediaHandle(session);
  let requests = 0;
  await withMockFetch(
    (request) => {
      requests += 1;
      assert.equal(new URL(request.url).pathname, "/library/streams/201.srt");
      assert.equal(request.headers.has("x-plex-session-identifier"), false);
      return new globalThis.Response("Sidecar subtitle text");
    },
    async () => {
      const response = createResponseRecorder();
      await proxyMedia(
        session,
        handle.id,
        createRequest() as ExpressRequest,
        response,
      );
      assert.equal(response.getBody(), "Sidecar subtitle text");
      assert.equal(requests, 1);
    },
  );
});

void test("preserves the selected Plex media version and part for embedded subtitles", () => {
  const session = createSession();
  const context = createContext();
  const item = embeddedSubtitleItem();
  const part = item.Media[0]?.Part[0];
  assert.ok(part);
  const versionedItem = {
    ...item,
    Media: [{ Part: [] }, { Part: [{ Stream: [] }, part] }],
  };
  const selection = { mediaIndex: 1, partIndex: 1 };
  const tracks = deriveSubtitleTracks(
    session,
    context,
    versionedItem,
    "viewer-session",
    selection,
  );
  const handle = onlyMediaHandle(session);
  const url = new URL(handle.path, context.baseUrl);
  assert.equal(url.searchParams.get("mediaIndex"), "1");
  assert.equal(url.searchParams.get("partIndex"), "1");
  assert.equal(
    tracks[0]?.contentUrl,
    deriveSubtitleTracks(
      session,
      context,
      versionedItem,
      "viewer-session",
      selection,
    )[0]?.contentUrl,
  );
  assert.equal(session.mediaHandles.size, 1);
});

void test("checks subtitles on the media version and part selected by the Plex decision", async () => {
  const session = createSession();
  const item = embeddedSubtitleItem();
  deriveSubtitleTracks(session, createContext(), item, "viewer-session");
  const handle = onlyMediaHandle(session);
  const wrongPart = { Stream: [{ id: "202", streamType: 3, selected: true }] };
  const decisionItem = {
    ...item,
    Media: [
      { Part: [wrongPart] },
      {
        selected: true,
        Part: [wrongPart, { ...item.Media[0]?.Part[0], selected: true }],
      },
    ],
  };
  await withMockFetch(
    (request) => {
      if (new URL(request.url).pathname.endsWith("/decision")) {
        return jsonResponse({ MediaContainer: { Metadata: [decisionItem] } });
      }
      return new globalThis.Response("Selected version subtitle");
    },
    async () => {
      const response = createResponseRecorder();
      await proxyMedia(
        session,
        handle.id,
        createRequest() as ExpressRequest,
        response,
      );
      assert.equal(response.getBody(), "Selected version subtitle");
    },
  );
});

void test("cancels Plex subtitle preparation and extraction when the browser disconnects", async () => {
  for (const phase of ["decision", "start"]) {
    const session = createSession();
    const item = embeddedSubtitleItem();
    deriveSubtitleTracks(session, createContext(), item, "viewer-session");
    const handle = onlyMediaHandle(session);
    let reachRequest: ((signal: AbortSignal) => void) | undefined;
    const reached = new Promise<AbortSignal>((resolve) => {
      reachRequest = resolve;
    });
    let rejectPending: ((reason: Error) => void) | undefined;
    const pending = new Promise<globalThis.Response>((_resolve, reject) => {
      rejectPending = reject;
    });
    const response = createResponseRecorder();
    const initialCloseListeners = response.listenerCount("close");
    let requests = 0;
    await withMockFetch(
      (request) => {
        requests += 1;
        if (!new URL(request.url).pathname.endsWith(`/${phase}`)) {
          return jsonResponse({ MediaContainer: { Metadata: [item] } });
        }
        reachRequest?.(request.signal);
        request.signal.addEventListener(
          "abort",
          () => {
            rejectPending?.(
              new DOMException("Browser disconnected", "AbortError"),
            );
          },
          { once: true },
        );
        return pending;
      },
      async () => {
        const load = proxyMedia(
          session,
          handle.id,
          createRequest() as ExpressRequest,
          response,
        );
        // Observe rejection immediately so an abort cannot become unhandled.
        const outcome = Promise.allSettled([load]);
        const signal = await reached;
        try {
          const closed = once(response, "close");
          response.destroy();
          await closed;
          assert.equal(signal.aborted, true);
          const results = await outcome;
          assert.equal(results[0]?.status, "fulfilled");
          assert.equal(response.listenerCount("close"), initialCloseListeners);
          assert.equal(requests, phase === "decision" ? 1 : 2);
        } finally {
          rejectPending?.(new DOMException("Test cleanup", "AbortError"));
          await outcome;
        }
      },
    );
  }
});

void test("rejects failed or malformed Plex decisions before starting subtitle extraction", async () => {
  const item = embeddedSubtitleItem();
  const failedDecisions = [
    JSON.stringify({
      MediaContainer: { mdeDecisionCode: 2000, Metadata: [item] },
    }),
    JSON.stringify({
      MediaContainer: { generalDecisionCode: 2001, Metadata: [item] },
    }),
    "not JSON",
    "null",
  ];
  for (const decision of failedDecisions) {
    const session = createSession();
    deriveSubtitleTracks(session, createContext(), item, "viewer-session");
    const handle = onlyMediaHandle(session);
    let requests = 0;
    await withMockFetch(
      () => {
        requests += 1;
        return new globalThis.Response(decision, {
          headers: { "content-type": "application/json" },
        });
      },
      async () => {
        const response = createResponseRecorder();
        const initialCloseListeners = response.listenerCount("close");
        await assert.rejects(
          proxyMedia(
            session,
            handle.id,
            createRequest() as ExpressRequest,
            response,
          ),
          {
            status: 502,
            code: "plex_subtitle_decision_failed",
          },
        );
        assert.equal(requests, 1);
        assert.equal(response.listenerCount("close"), initialCloseListeners);
      },
    );
  }
});
