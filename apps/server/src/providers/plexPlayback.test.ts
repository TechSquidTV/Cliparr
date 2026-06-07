import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import type { ProviderSessionRecord } from "@/session/store";
import {
  createPlexExportEstimateMetadata,
  createCliparrPlexTranscodeSessionId,
  createPlexViewerAvatarUrl,
  createPreviewPath,
  deriveSelectedSubtitleTrack,
  deriveSubtitleTracks,
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
  const recorder = {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: Buffer.alloc(0),
    ended: false,
    status(code: number) {
      recorder.statusCode = code;
      return recorder;
    },
    setHeader(name: string, value: string | number) {
      recorder.headers.set(name.toLowerCase(), String(value));
      return recorder;
    },
    end(chunk?: string | Uint8Array) {
      if (typeof chunk === "string") {
        recorder.body = Buffer.from(chunk);
      } else if (chunk) {
        recorder.body = Buffer.from(chunk);
      }
      recorder.ended = true;
      return recorder;
    },
  };

  return recorder;
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

void test("keeps Plex subtitle extraction on the real playback session id", () => {
  const session = createSession();
  const context = createContext();
  const plexPlaybackSessionId = "254";
  const cliparrTranscodeSessionId = createCliparrPlexTranscodeSessionId(
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

  const previewPath = createPreviewPath(item, cliparrTranscodeSessionId);
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
    cliparrTranscodeSessionId,
  );
  assert.equal(previewUrl.searchParams.get("subtitles"), "none");
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.contentUrl, `/api/media/${handle.id}`);
  assert.equal(tracks[0]?.contentFormat, "srt");
  assert.equal(tracks[0]?.streamId, "101151");
  assert.equal(handle.playbackSessionId, plexPlaybackSessionId);
  assert.equal(
    subtitleUrl.searchParams.get("transcodeSessionId"),
    plexPlaybackSessionId,
  );
  assert.notEqual(
    subtitleUrl.searchParams.get("transcodeSessionId"),
    cliparrTranscodeSessionId,
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
  const cliparrTranscodeSessionId = createCliparrPlexTranscodeSessionId(
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
  const previewPath = createPreviewPath(item, cliparrTranscodeSessionId);
  assert.ok(previewPath);
  const handleId = "hls-handle";
  session.mediaHandles.set(handleId, {
    id: handleId,
    providerId: "plex",
    sourceId: context.sourceId,
    baseUrl: context.baseUrl,
    path: previewPath,
    token: context.token,
    playbackSessionId: plexPlaybackSessionId,
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
      createRequest({ accept: "*/*" }) as Request,
      response as unknown as Response,
    );

    const upstreamUrl = new URL(requestUrls[0] ?? "");
    assert.equal(
      upstreamUrl.searchParams.get("transcodeSessionId"),
      cliparrTranscodeSessionId,
    );
    assert.equal(
      requestHeaders[0]?.get("x-plex-session-identifier"),
      plexPlaybackSessionId,
    );
    assert.notEqual(
      requestHeaders[0]?.get("x-plex-session-identifier"),
      cliparrTranscodeSessionId,
    );
    assert.equal(requestHeaders[0]?.get("x-plex-token"), context.token);
    assert.equal(response.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    handle.path.startsWith("/video/:/transcode/universal/subtitles?"),
    true,
  );
  assert.equal(
    transcodeUrl.searchParams.get("path"),
    "/library/metadata/12345",
  );
  assert.equal(
    transcodeUrl.searchParams.get("transcodeSessionId"),
    "plex-session-1",
  );
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
