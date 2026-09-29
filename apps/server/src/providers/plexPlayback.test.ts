import type { MediaSource } from "@/db/mediaSourcesRepository";
import { proxyMedia } from "@/providers/plex/mediaProxy";
import {
  createPlexViewerAvatarUrl,
  listCurrentlyPlaying,
} from "@/providers/plex/playback";
import {
  createCliparrPlexTranscodeSessionId,
  createPlexExportEstimateMetadata,
  createPreviewPath,
  deriveMediaSelection,
  deriveSelectedAudioTrack,
  mergePlaybackMetadata,
  resolveSelectedPart,
  playheadSecondsFromViewOffset,
} from "@/providers/plex/selection";
import type { PlexSourceContext } from "@/providers/plex/shared";
import { createExportMetadata } from "@/providers/plex/metadata";
import { createMediaHandle } from "@/providers/plex/mediaHandles";
import { mediaHandleRequestUrl } from "@/providers/shared/mediaProxy";
import type { PlexMetadataItem } from "@/providers/plex/selection";
import {
  deriveSelectedSubtitleTrack,
  deriveSubtitleTracks,
} from "@/providers/plex/subtitles";
import type { ProviderSessionRecord } from "@/session/store";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

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
        selected: true,
        Part: [
          {
            id: "part-1",
            selected: true,
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
        selected: true,
        Part: [
          {
            id: "28744",
            selected: true,
            Stream: [
              {
                id: "101151",
                index: 3,
                streamType: 3,
                codec: "srt",
                languageCode: "eng",
                selected: true,
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
        selected: true,
        Part: [
          {
            id: "28744",
            selected: true,
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
        selected: true,
        Part: [
          {
            id: "28744",
            selected: true,
            Stream: [
              {
                id: "101149",
                streamType: 1,
                codec: "h264",
                width: 1920,
                height: 1080,
                selected: true,
              },
              {
                id: "101150",
                streamType: 2,
                codec: "aac",
                languageCode: "eng",
                selected: true,
              },
              {
                id: "101151",
                index: 3,
                streamType: 3,
                codec: "srt",
                languageCode: "eng",
                selected: true,
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
  assert.equal(playheadSecondsFromViewOffset(0), 0);
  assert.equal(playheadSecondsFromViewOffset(-1), undefined);
  assert.equal(playheadSecondsFromViewOffset(undefined), undefined);
  assert.equal(playheadSecondsFromViewOffset(), undefined);
  assert.equal(playheadSecondsFromViewOffset(Number.NaN), undefined);
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
        selected: true,
        Part: [
          {
            id: "part-1",
            selected: true,
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
                selected: true,
              },
              {
                id: "audio-1",
                streamType: 2,
                bitrate: 160,
                selected: true,
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
        selected: true,
        Part: [
          {
            id: "part-1",
            selected: true,
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
  assert.equal(
    mediaHandleRequestUrl(onlyMediaHandle(session)).pathname,
    "/library/streams/101.srt",
  );
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
        selected: true,
        Part: [
          {
            id: "part-1",
            selected: true,
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
    transcodeUrl.pathname === "/subtitles/:/transcode/universal/start",
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
        selected: true,
        Part: [
          {
            id: "part-1",
            selected: true,
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
  assert.equal(
    mediaHandleRequestUrl(handle).pathname,
    "/library/streams/202.srt",
  );
});

void test("reports selected external Plex SRT content format consistently", () => {
  const item = {
    ratingKey: "12345",
    Media: [
      {
        id: "media-1",
        selected: true,
        Part: [
          {
            id: "part-1",
            selected: true,
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
        selected: true,
        Part: [
          {
            id: "part-1",
            selected: true,
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
        selected: true,
        Part: [
          {
            id: "part-1",
            selected: true,
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
        selected: true,
        Part: [
          {
            id: "part-1",
            selected: true,
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

void test("requires returned part keys and performs metadata enrichment only once", async () => {
  const session = createSession();
  const metadata = {
    ratingKey: "42",
    type: "movie",
    title: "Synthetic",
    Media: [{ id: 1, Part: [{ id: 2, file: "/media/example.mkv" }] }],
  };
  let metadataRequests = 0;
  await withMockFetch(
    (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/library/metadata/42") {
        metadataRequests += 1;
      } else {
        assert.equal(url.pathname, "/status/sessions");
      }
      return jsonResponse({ MediaContainer: { Metadata: [metadata] } });
    },
    async () => {
      const entries = await listCurrentlyPlaying(session, createSource());
      assert.equal(entries[0]?.item.mediaUrl, undefined);
      assert.ok(entries[0]?.item.hlsUrl);
      assert.equal(metadataRequests, 1);
    },
  );
});

void test("export artwork scopes nested credentials to the Plex origin", () => {
  const context = createContext();
  for (const thumb of [
    "/library/metadata/42/thumb?width=100",
    `${context.baseUrl}/library/metadata/42/thumb?X-Plex-Token=stale`,
    "https://artwork.example/poster.jpg?signed=123",
    "//artwork.example/poster.jpg?signed=123",
  ]) {
    const session = createSession();
    const metadata = createExportMetadata(session, context, { thumb });
    const handle = mediaHandleForUrl(session, metadata.imageUrl);
    const requestUrl = new URL(handle.path, context.baseUrl);
    const image = requestUrl.searchParams.get("url");
    assert.ok(image);
    const parsed = new URL(image, context.baseUrl);
    if (parsed.origin === context.baseUrl) {
      assert.deepEqual(parsed.searchParams.getAll("X-Plex-Token"), [
        context.token,
      ]);
    } else {
      assert.equal(image, thumb);
      assert.equal(parsed.searchParams.has("X-Plex-Token"), false);
    }
  }
});

void test("batch enrichment preserves each viewer's audio and subtitle selection", async () => {
  const session = createSession();
  const source = createSource();
  const currentItem = (
    sessionKey: string,
    spanish: boolean,
  ): PlexMetadataItem => ({
    ratingKey: "42",
    sessionKey,
    type: "movie",
    Media: [
      {
        id: 1,
        selected: true,
        Part: [
          {
            id: 2,
            selected: true,
            Stream: [
              {
                id: 10,
                streamType: 2,
                languageCode: "eng",
                selected: !spanish,
              },
              { id: 11, streamType: 2, languageCode: "spa", selected: spanish },
              { id: 20, streamType: 3, codec: "srt", selected: spanish },
            ],
          },
        ],
      },
    ],
  });
  const library: PlexMetadataItem = {
    ratingKey: "42",
    title: "Enriched title",
    type: "movie",
    Media: [
      {
        id: 1,
        Part: [
          {
            id: 2,
            key: "/returned/movie.mp4",
            Stream: [
              { id: 11, streamType: 2, languageCode: "spa", selected: false },
              { id: 10, streamType: 2, languageCode: "eng", selected: true },
              { id: 20, streamType: 3, codec: "srt", selected: true },
            ],
          },
        ],
      },
    ],
  };
  let metadataRequests = 0;
  await withMockFetch(
    (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/status/sessions") {
        return jsonResponse({
          MediaContainer: {
            Metadata: [
              currentItem("spanish", true),
              currentItem("english", false),
              { ratingKey: "99", sessionKey: "other", type: "track" },
              { sessionKey: "missing-id", title: "Live only", type: "track" },
            ],
          },
        });
      }
      metadataRequests += 1;
      assert.equal(decodeURIComponent(url.pathname), "/library/metadata/42,99");
      return jsonResponse({
        MediaContainer: {
          Metadata: [
            { ratingKey: "99", title: "Other title", type: "track" },
            { title: "Unmatched response" },
            library,
          ],
        },
      });
    },
    async () => {
      const entries = await listCurrentlyPlaying(session, source);
      assert.equal(metadataRequests, 1);
      assert.deepEqual(
        entries.map((entry) => entry.item.title),
        ["Enriched title", "Enriched title", "Other title", "Live only"],
      );
      assert.equal(entries[0]?.item.selectedAudioTrack?.languageCode, "spa");
      assert.equal(entries[0]?.item.selectedAudioTrack?.trackNumber, 1);
      assert.equal(entries[0]?.item.selectedSubtitleTrack?.streamId, "20");
      assert.equal(entries[1]?.item.selectedAudioTrack?.languageCode, "eng");
      assert.equal(entries[1]?.item.selectedAudioTrack?.trackNumber, 2);
      assert.equal(entries[1]?.item.selectedSubtitleTrack, undefined);
      assert.equal(entries[1]?.item.subtitleTracks?.length, 0);
      assert.equal(library.Media?.[0]?.Part?.[0]?.Stream?.[0]?.selected, false);
    },
  );
});

void test("returned raw subtitles are offered only with a supported content format", () => {
  for (const codec of ["srt", "vtt", "ass", "ttml"]) {
    const session = createSession();
    const path = `https://subtitles.example/captions.${codec}?signed=123`;
    const item = {
      ratingKey: "42",
      Media: [
        {
          Part: [
            {
              Stream: [
                { id: 20, streamType: 3, codec, key: path, selected: true },
              ],
            },
          ],
        },
      ],
    };
    const [track] = deriveSubtitleTracks(
      session,
      createContext(),
      item,
      "viewer",
    );
    const selected = deriveSelectedSubtitleTrack(item);
    if (codec === "srt" || codec === "vtt") {
      assert.equal(track?.contentFormat, codec);
      assert.equal(selected?.contentFormat, codec);
      assert.equal(mediaHandleForUrl(session, track?.contentUrl).path, path);
    } else {
      assert.equal(track?.contentFormat, undefined);
      assert.equal(selected?.contentFormat, undefined);
      assert.equal(track?.contentUrl, undefined);
      assert.equal(session.mediaHandles.size, 0);
    }
  }
});

void test("recognized local ASS streams request generated VTT conversion", () => {
  const session = createSession();
  const item = {
    Media: [
      {
        Part: [
          {
            Stream: [
              {
                id: 20,
                streamType: 3,
                codec: "ass",
                key: "/library/streams/20",
                selected: true,
              },
            ],
          },
        ],
      },
    ],
  };
  const [track] = deriveSubtitleTracks(
    session,
    createContext(),
    item,
    "viewer",
  );
  assert.equal(track?.contentFormat, "vtt");
  assert.equal(
    mediaHandleForUrl(session, track?.contentUrl).path,
    `${createContext().baseUrl}/library/streams/20.ass?format=vtt`,
  );
});

void test("enrichment preserves live resource fields and selection while adding descriptions", () => {
  const live: PlexMetadataItem = {
    ratingKey: "42",
    Media: [
      {
        id: 1,
        Part: [
          {
            id: 2,
            key: "/returned/live.mp4",
            Stream: [
              {
                id: 3,
                streamType: 3,
                codec: "srt",
                key: "https://subtitles.example/live.srt",
                selected: false,
              },
            ],
          },
        ],
      },
    ],
  };
  const library: PlexMetadataItem = {
    ratingKey: "42",
    Media: [
      {
        id: 1,
        Part: [
          {
            id: 2,
            Stream: [
              {
                id: 3,
                streamType: 3,
                languageCode: "eng",
                title: "English",
                selected: true,
              },
            ],
          },
        ],
      },
    ],
  };
  const merged = mergePlaybackMetadata(live, library);
  const selection = deriveMediaSelection(live);
  assert.equal(
    resolveSelectedPart(merged, selection)?.part?.key,
    "/returned/live.mp4",
  );
  assert.equal(deriveSelectedSubtitleTrack(merged, selection), undefined);
  const session = createSession();
  const [track] = deriveSubtitleTracks(
    session,
    createContext(),
    merged,
    "viewer",
    selection,
  );
  assert.equal(track?.title, "English");
  assert.equal(track?.languageCode, "eng");
  assert.equal(track?.codec, "srt");
  assert.equal(
    mediaHandleForUrl(session, track?.contentUrl).path,
    "https://subtitles.example/live.srt",
  );
});

void test("enrichment uses position only when media or part identity is missing", () => {
  for (const missingFrom of ["live", "library"] as const) {
    const live: PlexMetadataItem = {
      ratingKey: "42",
      Media: [
        {
          id: missingFrom === "live" ? undefined : 1,
          Part: [
            {
              id: missingFrom === "live" ? undefined : 2,
              Stream: [
                { id: 10, streamType: 2, languageCode: "eng", selected: false },
                { id: 11, streamType: 2, languageCode: "spa", selected: true },
              ],
            },
          ],
        },
      ],
    };
    const library: PlexMetadataItem = {
      ratingKey: "42",
      Media: [
        {
          id: missingFrom === "library" ? undefined : 1,
          Part: [
            {
              id: missingFrom === "library" ? undefined : 2,
              Stream: [
                { id: 10, streamType: 2, languageCode: "eng", selected: true },
                { id: 11, streamType: 2, languageCode: "spa", selected: false },
              ],
            },
          ],
        },
      ],
    };
    const merged = mergePlaybackMetadata(live, library);
    const selection = deriveMediaSelection(live);
    assert.equal(
      deriveSelectedAudioTrack(merged, selection)?.languageCode,
      "spa",
    );
    assert.ok(createPreviewPath(merged, "preview", selection));
  }
});

void test("explicit identity conflicts and invalid positions never select another Plex version", () => {
  const item: PlexMetadataItem = {
    ratingKey: "42",
    Media: [
      {
        id: 1,
        Part: [
          {
            id: 2,
            Stream: [{ id: 3, streamType: 3, codec: "srt", selected: true }],
          },
        ],
      },
    ],
  };
  for (const selection of [
    { mediaId: "99", mediaIndex: 0 },
    { mediaId: "1", mediaIndex: 0, partId: "99", partIndex: 0 },
    { mediaIndex: 4 },
    { mediaIndex: 0, partIndex: 4 },
  ]) {
    assert.equal(resolveSelectedPart(item, selection), undefined);
    assert.equal(createPreviewPath(item, "preview", selection), undefined);
    assert.deepEqual(
      deriveSubtitleTracks(
        createSession(),
        createContext(),
        item,
        "viewer",
        selection,
      ),
      [],
    );
  }
  assert.equal(
    createPreviewPath({ ...item, Media: [] }, "preview", {
      mediaId: "1",
      mediaIndex: 0,
    }),
    undefined,
  );
  assert.equal(
    resolveSelectedPart({ Media: [{ id: 1 }] }, { mediaId: "1", partId: "2" }),
    undefined,
  );
});

void test("enrichment follows matching media and part IDs after library reordering", () => {
  const live: PlexMetadataItem = {
    ratingKey: "42",
    Media: [
      {
        id: 20,
        Part: [
          {
            id: 21,
            key: "/returned/live.mp4",
            Stream: [{ id: 3, streamType: 3, codec: "srt", selected: true }],
          },
        ],
      },
    ],
  };
  const library: PlexMetadataItem = {
    ratingKey: "42",
    Media: [
      { id: 10, Part: [{ id: 11 }] },
      { id: 20, Part: [{ id: 22 }, { id: 21 }] },
    ],
  };
  const merged = mergePlaybackMetadata(live, library);
  const selection = deriveMediaSelection(live);
  const preview = createPreviewPath(merged, "preview", selection);
  assert.ok(preview);
  const url = new URL(preview, createContext().baseUrl);
  assert.equal(url.searchParams.get("mediaIndex"), "1");
  assert.equal(url.searchParams.get("partIndex"), "1");
  assert.equal(
    resolveSelectedPart(merged, selection)?.part?.key,
    "/returned/live.mp4",
  );
  assert.equal(deriveSelectedSubtitleTrack(merged, selection)?.streamId, "3");
});

void test("missing library versions preserve direct-file audio selection but omit unresolved previews", async () => {
  for (const conflict of ["media", "part"] as const) {
    const session = createSession();
    const live: PlexMetadataItem = {
      ratingKey: "42",
      type: "movie",
      Media: [
        {
          id: 20,
          Part: [
            {
              id: 21,
              key: "/returned/live.mp4",
              Stream: [
                { id: 30, streamType: 2, languageCode: "eng", selected: false },
                { id: 31, streamType: 2, languageCode: "spa", selected: true },
              ],
            },
          ],
        },
      ],
    };
    const library: PlexMetadataItem = {
      ratingKey: "42",
      type: "movie",
      Media: [
        {
          id: conflict === "media" ? 10 : 20,
          Part: [{ id: 11, key: "/returned/other.mp4" }],
        },
      ],
    };
    await withMockFetch(
      (request) =>
        jsonResponse({
          MediaContainer: {
            Metadata: [
              new URL(request.url).pathname === "/status/sessions"
                ? live
                : library,
            ],
          },
        }),
      async () => {
        const [entry] = await listCurrentlyPlaying(session, createSource());
        assert.equal(
          mediaHandleForUrl(session, entry?.item.mediaUrl).path,
          "/returned/live.mp4",
        );
        assert.equal(entry?.item.hlsUrl, undefined);
        assert.equal(entry?.item.selectedAudioTrack?.trackNumber, 2);
        assert.equal(entry?.item.selectedAudioTrack?.languageCode, "spa");
      },
    );
  }
});

void test("generated Plex media operations preserve API base paths without rewriting resource links", async () => {
  for (const prefix of ["/plex", "/media/plex/"]) {
    const session = createSession();
    const context = {
      ...createContext(),
      baseUrl: `${createContext().baseUrl}${prefix}`,
    };
    const normalizedPrefix = prefix.replace(/\/$/, "");
    const item = {
      ...embeddedSubtitleItem(),
      thumb: "/library/metadata/12345/thumb",
    };
    await withMockFetch(
      (request) => {
        const url = new URL(request.url);
        assert.ok(
          [
            `${normalizedPrefix}/status/sessions`,
            `${normalizedPrefix}/library/metadata/12345`,
          ].includes(url.pathname),
        );
        return jsonResponse({ MediaContainer: { Metadata: [item] } });
      },
      async () => {
        const [entry] = await listCurrentlyPlaying(session, {
          ...createSource(),
          baseUrl: context.baseUrl,
        });
        const preview = mediaHandleRequestUrl(
          mediaHandleForUrl(session, entry?.item.hlsUrl),
        );
        assert.equal(
          preview.pathname,
          `${normalizedPrefix}/video/:/transcode/universal/start.m3u8`,
        );
        assert.equal(
          preview.searchParams.get("path"),
          "/library/metadata/12345",
        );
        const artwork = mediaHandleRequestUrl(
          mediaHandleForUrl(session, entry?.item.exportMetadata?.imageUrl),
        );
        assert.equal(artwork.pathname, `${normalizedPrefix}/photo/:/transcode`);
        assert.ok(
          artwork.searchParams
            .get("url")
            ?.startsWith("/library/metadata/12345/thumb?"),
        );
      },
    );

    const [track] = deriveSubtitleTracks(session, context, item, "viewer");
    const handle = mediaHandleForUrl(session, track?.contentUrl);
    const requests: string[] = [];
    await withMockFetch(
      (request) => {
        const url = new URL(request.url);
        requests.push(url.pathname);
        assert.equal(request.headers.get("x-plex-token"), context.token);
        assert.equal(url.searchParams.get("path"), "/library/metadata/12345");
        if (url.pathname.endsWith("/decision")) {
          return jsonResponse({ MediaContainer: { Metadata: [item] } });
        }
        return new globalThis.Response("Subtitle text");
      },
      async () => {
        const response = createResponseRecorder();
        await proxyMedia(
          session,
          handle.id,
          createRequest() as ExpressRequest,
          response,
        );
        assert.equal(response.getBody(), "Subtitle text");
      },
    );
    assert.deepEqual(requests, [
      `${normalizedPrefix}/video/:/transcode/universal/decision`,
      `${normalizedPrefix}/subtitles/:/transcode/universal/start`,
    ]);

    const sidecar = {
      Media: [
        {
          Part: [
            {
              Stream: [
                {
                  id: 3,
                  streamType: 3,
                  codec: "ass",
                  key: "/library/streams/3",
                },
              ],
            },
          ],
        },
      ],
    };
    const [sidecarTrack] = deriveSubtitleTracks(
      session,
      context,
      sidecar,
      "viewer",
    );
    const sidecarUrl = mediaHandleRequestUrl(
      mediaHandleForUrl(session, sidecarTrack?.contentUrl),
    );
    assert.equal(
      sidecarUrl.pathname,
      `${normalizedPrefix}/library/streams/3.ass`,
    );
    assert.equal(sidecarUrl.searchParams.get("format"), "vtt");

    for (const resource of [
      "/returned/movie.mp4",
      `${normalizedPrefix}/already-prefixed.mp4`,
      "https://external.example/movie.mp4?signature=123",
      "//external.example/subtitle.srt",
    ]) {
      const resourceHandle = mediaHandleForUrl(
        session,
        createMediaHandle(session, context, resource),
      );
      assert.equal(resourceHandle.path, resource);
      assert.equal(
        mediaHandleRequestUrl(resourceHandle).href,
        new URL(resource, context.baseUrl).href,
      );
    }
  }
});

void test("partial library streams retain live-only fields and ID-less resources", () => {
  const live: PlexMetadataItem = {
    ratingKey: "42",
    Media: [
      {
        id: 1,
        Part: [
          {
            id: 2,
            Stream: [
              {
                id: 3,
                streamType: 3,
                codec: "srt",
                key: "/returned/english.srt",
                selected: false,
              },
              {
                streamType: 3,
                codec: "vtt",
                key: "/returned/spanish.vtt",
                selected: true,
              },
            ],
          },
        ],
      },
    ],
  };
  for (const streams of [undefined, [{ id: 3, title: "English" }]]) {
    const merged = mergePlaybackMetadata(live, {
      Media: [{ id: 1, Part: [{ id: 2, Stream: streams }] }],
    });
    const session = createSession();
    const tracks = deriveSubtitleTracks(
      session,
      createContext(),
      merged,
      "viewer",
    );
    assert.deepEqual(
      tracks.map((track) => mediaHandleForUrl(session, track.contentUrl).path),
      ["/returned/english.srt", "/returned/spanish.vtt"],
    );
    assert.equal(deriveSelectedSubtitleTrack(merged)?.codec, "vtt");
  }
});

void test("partial live stream lists match source locators before array position", () => {
  for (const locator of ["index", "streamIdentifier"] as const) {
    for (const idless of ["live", "library"] as const) {
      const live: PlexMetadataItem = {
        Media: [
          {
            id: 1,
            Part: [
              {
                id: 2,
                Stream: [
                  {
                    id: idless === "live" ? undefined : 11,
                    streamType: 2,
                    [locator]: 2,
                    languageCode: "spa",
                    selected: true,
                  },
                ],
              },
            ],
          },
        ],
      };
      const library: PlexMetadataItem = {
        Media: [
          {
            id: 1,
            Part: [
              {
                id: 2,
                Stream: [
                  {
                    id: idless === "library" ? undefined : 10,
                    streamType: 2,
                    [locator]: 1,
                    languageCode: "eng",
                    selected: true,
                  },
                  {
                    id: idless === "library" ? undefined : 11,
                    streamType: 2,
                    [locator]: 2,
                    languageCode: "spa",
                    selected: false,
                  },
                ],
              },
            ],
          },
        ],
      };
      const merged = mergePlaybackMetadata(live, library);
      assert.equal(resolveSelectedPart(merged)?.part?.Stream?.length, 2);
      assert.equal(deriveSelectedAudioTrack(merged)?.languageCode, "spa");
      assert.equal(deriveSelectedAudioTrack(merged)?.trackNumber, 2);
    }
  }
});

void test("subtitle enrichment never attaches a live resource to a contradictory source locator", () => {
  for (const locator of ["index", "streamIdentifier"] as const) {
    const live: PlexMetadataItem = {
      Media: [
        {
          Part: [
            {
              Stream: [
                {
                  streamType: 3,
                  [locator]: 2,
                  codec: "srt",
                  key: "/returned/spanish.srt",
                  selected: true,
                },
              ],
            },
          ],
        },
      ],
    };
    const library: PlexMetadataItem = {
      Media: [
        {
          Part: [
            {
              Stream: [
                {
                  id: 10,
                  streamType: 3,
                  [locator]: 1,
                  codec: "srt",
                  languageCode: "eng",
                  key: "/returned/english.srt",
                },
                {
                  id: 11,
                  streamType: 3,
                  [locator]: 2,
                  codec: "srt",
                  languageCode: "spa",
                },
              ],
            },
          ],
        },
      ],
    };
    const merged = mergePlaybackMetadata(live, library);
    assert.equal(deriveSelectedSubtitleTrack(merged)?.streamId, "11");
    const session = createSession();
    const tracks = deriveSubtitleTracks(
      session,
      createContext(),
      merged,
      "viewer",
    );
    assert.deepEqual(
      tracks.map((track) => ({
        language: track.languageCode,
        path: mediaHandleForUrl(session, track.contentUrl).path,
      })),
      [
        { language: "eng", path: "/returned/english.srt" },
        { language: "spa", path: "/returned/spanish.srt" },
      ],
    );
  }
});

void test("stream locators cannot override conflicting IDs or stream types", () => {
  for (const other of [
    { id: 12, index: 2, streamType: 2 },
    { index: 2, streamType: 3 },
    { index: 1, streamIdentifier: 2, streamType: 2 },
  ]) {
    const live: PlexMetadataItem = {
      Media: [
        {
          Part: [
            {
              Stream: [
                {
                  id: 11,
                  index: 2,
                  streamIdentifier: 2,
                  streamType: 2,
                  languageCode: "spa",
                  selected: true,
                },
              ],
            },
          ],
        },
      ],
    };
    const library: PlexMetadataItem = {
      Media: [
        {
          Part: [
            { Stream: [{ ...other, languageCode: "eng", selected: false }] },
          ],
        },
      ],
    };
    const streams = resolveSelectedPart(mergePlaybackMetadata(live, library))
      ?.part?.Stream;
    assert.equal(streams?.length, 2);
    assert.equal(streams?.[0]?.selected, false);
    assert.equal(streams?.[1]?.languageCode, "spa");
    assert.equal(streams?.[1]?.selected, true);
  }
});

void test("positional stream guesses cannot steal a stronger match elsewhere", () => {
  const live: PlexMetadataItem = {
    Media: [
      {
        Part: [
          {
            Stream: [
              { index: 2, streamType: 2, languageCode: "spa", selected: true },
            ],
          },
        ],
      },
    ],
  };
  const library: PlexMetadataItem = {
    Media: [
      {
        Part: [
          {
            Stream: [
              { id: 10, streamType: 2, languageCode: "eng" },
              { id: 11, index: 2, streamType: 2, languageCode: "spa" },
            ],
          },
        ],
      },
    ],
  };
  const merged = mergePlaybackMetadata(live, library);
  const streams = resolveSelectedPart(merged)?.part?.Stream;
  assert.equal(streams?.length, 2);
  assert.deepEqual(
    streams?.map((stream) => stream.selected),
    [false, true],
  );
  assert.equal(deriveSelectedAudioTrack(merged)?.trackNumber, 2);
  assert.equal(deriveSelectedAudioTrack(merged)?.languageCode, "spa");
});
