import {
  TEST_JELLYFIN_BASE_URL,
  useProviderFixtures,
} from "@/test/providerFixtures";
import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import type { MediaSource } from "@/db/mediaSourcesRepository";
import type { ProviderSessionRecord } from "@/session/store";
import {
  buildPreviewPath,
  createJellyfinPlaybackResolver,
  createJellyfinExportEstimateMetadata,
  deriveSelectedSubtitleTrack,
  deriveSubtitleTracks,
  listCurrentlyPlaying,
  playheadSecondsFromPositionTicks,
  proxyMedia,
  sourceSupportsCurrentlyPlaying,
} from "@/providers/jellyfin/playback";
import type {
  JellyfinItem,
  JellyfinSessionInfo,
  JellyfinSourceContext,
  JellyfinUser,
} from "@/providers/jellyfin/shared";
import { mediaHandleRequestUrl } from "@/providers/shared/mediaProxy";

let sessionIndex = 0;

function createSession(): ProviderSessionRecord {
  sessionIndex += 1;
  return {
    id: `session-${sessionIndex}`,
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
    baseUrl: TEST_JELLYFIN_BASE_URL,
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
    baseUrl: TEST_JELLYFIN_BASE_URL,
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
  assert.ok(handle);
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
  const recorder = {
    statusCode: 200,
    headers: new Map<string, string>(),
    ended: false,
    status(code: number) {
      recorder.statusCode = code;
      return recorder;
    },
    setHeader(name: string, value: string | number) {
      recorder.headers.set(name.toLowerCase(), String(value));
      return recorder;
    },
    end() {
      recorder.ended = true;
      return recorder;
    },
  };

  return recorder;
}

function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, {
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
  currentUser?: JellyfinUser;
  sessions?: JellyfinSessionInfo[];
  jellyfinPlaySessionId?: string | null | (() => string | null);
  jellyfinClientSessionId?: string;
  mediaSourceId?: string;
  playStateAudioStreamIndex?: number | null;
  defaultAudioStreamIndex?: number | null;
  audioStreams?: Array<Record<string, unknown>>;
  title?: string;
  withArtwork?: boolean;
  itemMetadata?: Pick<
    JellyfinItem,
    "ProviderIds" | "CriticRating" | "CommunityRating"
  >;
}) {
  const {
    itemId,
    currentUser = { Id: "user-1" },
    sessions,
    jellyfinPlaySessionId = "playback-info-session-1",
    jellyfinClientSessionId = "client-session-1",
    mediaSourceId = "media-source-1",
    playStateAudioStreamIndex = 1,
    defaultAudioStreamIndex = 1,
    audioStreams = [
      {
        Type: "Audio",
        Index: 1,
        Codec: "aac",
        Language: "eng",
        Title: "English",
        IsDefault: true,
      },
    ],
    title = "Chapter 1: The Dark Revenge",
    withArtwork = false,
    itemMetadata,
  } = options;
  const mediaSource = {
    Id: mediaSourceId,
    ...(defaultAudioStreamIndex === null
      ? {}
      : { DefaultAudioStreamIndex: defaultAudioStreamIndex }),
    MediaStreams: [
      {
        Type: "Video",
        Codec: "h264",
        Index: 0,
        Width: 1920,
        Height: 1080,
      },
      ...audioStreams,
    ],
  };
  const item = {
    ...itemMetadata,
    Id: itemId,
    ...(withArtwork ? { ImageTags: { Primary: "artwork-tag" } } : {}),
    Name: title,
    Type: "Episode",
    MediaType: "Video",
    RunTimeTicks: 16_980_000_000,
    MediaSources: [
      {
        Id: "stale-session-media-source",
        MediaStreams: [],
      },
    ],
  };

  return (async (input) => {
    const url = fetchInputUrl(input);

    if (url.pathname === "/Users/Me") {
      return jsonResponse(currentUser);
    }

    if (url.pathname === "/Sessions") {
      return jsonResponse(
        sessions ?? [
          {
            Id: jellyfinClientSessionId,
            UserId: "user-1",
            UserName: "Rick",
            DeviceName: "Chrome",
            PlayState: {
              MediaSourceId: mediaSourceId,
              IsPaused: true,
              ...(playStateAudioStreamIndex === null
                ? {}
                : { AudioStreamIndex: playStateAudioStreamIndex }),
              PositionTicks: 1_234_560_000,
            },
            NowPlayingItem: item,
          },
        ],
      );
    }

    if (url.pathname === `/Items/${itemId}`) {
      return jsonResponse(item);
    }

    if (url.pathname === `/Items/${itemId}/PlaybackInfo`) {
      const resolvedJellyfinPlaySessionId =
        typeof jellyfinPlaySessionId === "function"
          ? jellyfinPlaySessionId()
          : jellyfinPlaySessionId;
      return jsonResponse({
        ...(resolvedJellyfinPlaySessionId
          ? { PlaySessionId: resolvedJellyfinPlaySessionId }
          : {}),
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
  assert.ok(path);

  const url = new URL(path, "http://cliparr.local");

  assert.equal(url.pathname, "/Videos/item-1/master.m3u8");
  assert.equal(url.searchParams.get("mediaSourceId"), "media-source-1");
  assert.equal(url.searchParams.get("deviceId"), "cliparr-device-1");
  assert.equal(url.searchParams.get("playSessionId"), "play-session-1");
  assert.equal(url.searchParams.get("videoCodec"), "h264");
  assert.equal(url.searchParams.get("videoBitRate"), "12000000");
  assert.equal(url.searchParams.get("maxWidth"), "1920");
  assert.equal(url.searchParams.get("maxHeight"), "1080");
  assert.equal(url.searchParams.get("maxVideoBitDepth"), "8");
  assert.equal(url.searchParams.get("allowVideoStreamCopy"), "false");
  assert.equal(url.searchParams.get("enableAutoStreamCopy"), "false");
  assert.equal(
    url.searchParams.get("alwaysBurnInSubtitleWhenTranscoding"),
    "false",
  );
  assert.equal(url.searchParams.has("subtitleStreamIndex"), false);
});

void test("extracts Jellyfin export size estimate metadata from media sources", () => {
  const mediaSource = {
    Size: 120_000_000,
    RunTimeTicks: 6_000_000_000,
    Bitrate: 1_600_000,
    MediaStreams: [
      {
        Type: "Video",
        Codec: "h264",
        BitRate: 1_400_000,
        Width: 1920,
        Height: 1080,
        AverageFrameRate: 23.976,
        IsDefault: true,
      },
      {
        Type: "Audio",
        BitRate: 160_000,
        IsDefault: true,
      },
    ],
  };

  assert.deepEqual(createJellyfinExportEstimateMetadata(mediaSource, 0), {
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

void test("converts Jellyfin PositionTicks into playhead seconds", () => {
  assert.equal(playheadSecondsFromPositionTicks(1_234_560_000), 123.456);
  assert.equal(playheadSecondsFromPositionTicks(0), 0);
  assert.equal(playheadSecondsFromPositionTicks(-1), undefined);
  assert.equal(playheadSecondsFromPositionTicks(null), undefined);
  assert.equal(playheadSecondsFromPositionTicks(), undefined);
});

void test("uses Jellyfin PlaybackInfo play session ids for currently playing streams", async () => {
  const session = createSession();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createJellyfinPlaybackFetch({
    itemId: "item-1",
    jellyfinPlaySessionId: "playback-info-session-1",
    jellyfinClientSessionId: "client-session-1",
  });

  try {
    const entries = await listCurrentlyPlaying(session, createSource());

    assert.equal(entries.length, 1);
    assert.equal(
      entries[0]?.item.id,
      "source-1:client-session-1:item-1:media-source-1",
    );
    assert.equal(entries[0]?.item.playheadSeconds, 123.456);
    assert.ok(entries[0]?.item.mediaUrl);
    assert.ok(entries[0]?.item.hlsUrl);

    const streamHandle = [...session.mediaHandles.values()].find((handle) =>
      handle.path.includes("/stream?"),
    );
    const hlsHandle = [...session.mediaHandles.values()].find((handle) =>
      handle.path.includes("/master.m3u8?"),
    );
    assert.ok(streamHandle);
    assert.ok(hlsHandle);

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

for (const isAdministrator of [true, false, undefined]) {
  void test(`scopes Jellyfin playback using the current administrator policy: ${isAdministrator}`, async (context) => {
    const session = createSession();
    const source = createSource();
    source.metadata.isAdministrator = isAdministrator !== true;
    const sessions: JellyfinSessionInfo[] = [
      {
        Id: "own-desktop",
        UserId: "user-1",
        DeviceName: "Desktop",
        NowPlayingItem: { Id: "own-item" },
      },
      {
        Id: "own-tv",
        UserId: "user-1",
        DeviceName: "TV",
        NowPlayingItem: { Id: "own-item" },
      },
      {
        Id: "other-user",
        UserId: "user-2",
        NowPlayingItem: { Id: "other-item" },
      },
      {
        Id: "anonymous",
        UserId: "00000000000000000000000000000000",
        NowPlayingItem: { Id: "anonymous-item" },
      },
      { Id: "missing-user", NowPlayingItem: { Id: "missing-user-item" } },
      { Id: "idle", UserId: "user-1" },
    ];
    const itemRequests: string[] = [];
    const upstreamFetch = createJellyfinPlaybackFetch({
      itemId: "own-item",
      currentUser: {
        Id: "user-1",
        ...(isAdministrator === undefined
          ? {}
          : {
              Policy: {
                IsAdministrator: isAdministrator,
                AuthenticationProviderId: "auth-provider",
                PasswordResetProviderId: "password-reset-provider",
              },
            }),
      },
      sessions,
    });
    context.mock.method(
      globalThis,
      "fetch",
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = fetchInputUrl(input);
        if (url.pathname.startsWith("/Items/")) {
          const itemId = url.pathname.split("/")[2];
          assert.ok(itemId);
          itemRequests.push(itemId);
          url.pathname = url.pathname.replace(itemId, "own-item");
        }
        return upstreamFetch(url, init);
      },
    );

    assert.equal(sourceSupportsCurrentlyPlaying(source), true);
    const entries = await listCurrentlyPlaying(session, source);
    assert.equal(entries.length, isAdministrator === true ? 5 : 2);
    assert.deepEqual(
      new Set(itemRequests),
      new Set(
        isAdministrator === true
          ? ["own-item", "other-item", "anonymous-item", "missing-user-item"]
          : ["own-item"],
      ),
    );
    assert.deepEqual(
      entries.slice(0, 2).map((entry) => entry.item.playerTitle),
      ["Desktop", "TV"],
    );
    for (const entry of entries) {
      assert.ok(entry.item.mediaUrl);
      assert.ok(entry.item.hlsUrl);
    }
  });
}

void test("does not discover Jellyfin playback without an access token", () => {
  const source = createSource();
  delete source.credentials.accessToken;
  assert.equal(sourceSupportsCurrentlyPlaying(source), false);
});

void test("does not use cached admin access when Jellyfin authentication fails", async (context) => {
  const source = createSource();
  source.metadata.isAdministrator = true;
  const session = createSession();
  const upstreamFetch = createJellyfinPlaybackFetch({ itemId: "item-1" });
  context.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (fetchInputUrl(input).pathname === "/Users/Me") {
        return jsonResponse({ message: "Unauthorized" }, 401);
      }
      return upstreamFetch(input, init);
    },
  );

  await assert.rejects(listCurrentlyPlaying(session, source), {
    status: 401,
    code: "jellyfin_auth_failed",
  });
  assert.equal(session.mediaHandles.size, 0);
});

void test("preserves Jellyfin base paths for streams, previews, artwork, and subtitles", async (context) => {
  for (const prefix of ["/jellyfin", "/media/jellyfin/"]) {
    const session = createSession();
    const source = {
      ...createSource(),
      baseUrl: `${TEST_JELLYFIN_BASE_URL}${prefix}`,
    };
    const normalizedPrefix = prefix.replace(/\/$/, "");
    const upstreamFetch = createJellyfinPlaybackFetch({
      itemId: "item-prefix",
      withArtwork: true,
    });
    context.mock.method(
      globalThis,
      "fetch",
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = fetchInputUrl(input);
        assert.ok(url.pathname.startsWith(`${normalizedPrefix}/`));
        url.pathname = url.pathname.slice(normalizedPrefix.length);
        return upstreamFetch(url, init);
      },
    );
    const entries = await listCurrentlyPlaying(session, source);
    assert.equal(entries.length, 1);
    assert.ok(entries[0]?.item.mediaUrl);
    assert.ok(entries[0]?.item.hlsUrl);
    const providerContext = { ...createContext(), baseUrl: source.baseUrl };
    deriveSubtitleTracks(
      session,
      providerContext,
      {
        Id: "item-prefix",
        MediaSources: [
          {
            Id: "media-source-1",
            MediaStreams: [
              {
                Type: "Subtitle",
                Index: 2,
                Codec: "srt",
                IsTextSubtitleStream: true,
              },
            ],
          },
        ],
      },
      "media-source-1",
    );
    const paths = new Set(
      [...session.mediaHandles.values()].map(
        (handle) => mediaHandleRequestUrl(handle).pathname,
      ),
    );
    assert.ok(paths.has(`${normalizedPrefix}/Videos/item-prefix/stream`));
    assert.ok(paths.has(`${normalizedPrefix}/Videos/item-prefix/master.m3u8`));
    assert.ok(
      paths.has(`${normalizedPrefix}/Items/item-prefix/Images/Primary`),
    );
    assert.ok(
      paths.has(
        `${normalizedPrefix}/Videos/item-prefix/media-source-1/Subtitles/2/Stream.vtt`,
      ),
    );
    for (const handle of session.mediaHandles.values()) {
      assert.ok(
        mediaHandleRequestUrl(handle).pathname.startsWith(
          `${normalizedPrefix}/`,
        ),
      );
      if (handle.basePath) {
        assert.ok(handle.basePath.startsWith(`${normalizedPrefix}/`));
      }
    }
  }
});

void test("uses Jellyfin PlayState audio stream index for HLS previews", async () => {
  const session = createSession();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = createJellyfinPlaybackFetch({
    itemId: "item-1",
    playStateAudioStreamIndex: 3,
    defaultAudioStreamIndex: 1,
    audioStreams: [
      {
        Type: "Audio",
        Index: 1,
        Codec: "aac",
        Language: "deu",
        Title: "German",
        IsDefault: true,
      },
      {
        Type: "Audio",
        Index: 3,
        Codec: "aac",
        Language: "eng",
        Title: "English",
      },
    ],
  });

  try {
    const entries = await listCurrentlyPlaying(session, createSource());

    const hlsHandle = [...session.mediaHandles.values()].find((handle) =>
      handle.path.includes("/master.m3u8?"),
    );
    assert.ok(hlsHandle);

    const hlsUrl = new URL(hlsHandle.path, "http://cliparr.local");
    assert.equal(hlsUrl.searchParams.get("audioStreamIndex"), "3");
    assert.equal(entries[0]?.item.selectedAudioTrack?.trackNumber, 2);
    assert.equal(entries[0]?.item.selectedAudioTrack?.languageCode, "eng");
    assert.equal(entries[0]?.item.selectedAudioTrack?.title, "English");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("reuses Jellyfin playback info for stable currently playing handles", async () => {
  const session = createSession();
  const originalFetch = globalThis.fetch;
  let playbackInfoRequestCount = 0;
  globalThis.fetch = createJellyfinPlaybackFetch({
    itemId: "item-1",
    jellyfinPlaySessionId: () => {
      playbackInfoRequestCount += 1;
      return `playback-info-session-${playbackInfoRequestCount}`;
    },
    jellyfinClientSessionId: "client-session-1",
  });

  try {
    const firstEntries = await listCurrentlyPlaying(session, createSource());
    const handleCount = session.mediaHandles.size;
    const secondEntries = await listCurrentlyPlaying(session, createSource());

    assert.equal(playbackInfoRequestCount, 1);
    assert.equal(session.mediaHandles.size, handleCount);
    assert.equal(
      firstEntries[0]?.item.mediaUrl,
      secondEntries[0]?.item.mediaUrl,
    );
    assert.equal(firstEntries[0]?.item.hlsUrl, secondEntries[0]?.item.hlsUrl);

    const streamHandle = [...session.mediaHandles.values()].find((handle) =>
      handle.path.includes("/stream?"),
    );
    const hlsHandle = [...session.mediaHandles.values()].find((handle) =>
      handle.path.includes("/master.m3u8?"),
    );
    assert.ok(streamHandle);
    assert.ok(hlsHandle);

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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test("keeps Jellyfin currently playing item ids stable and item-scoped", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = createJellyfinPlaybackFetch({
      itemId: "item-1",
      jellyfinClientSessionId: "client-session-1",
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
      jellyfinClientSessionId: "client-session-1",
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
    jellyfinPlaySessionId: null,
    jellyfinClientSessionId: "client-session-1",
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

  const tracks = deriveSubtitleTracks(session, context, item);
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
    baseUrl: TEST_JELLYFIN_BASE_URL,
    path: "/Videos/item-1/stream",
    token: "provider-token",
    providerMetadata: {
      jellyfin: {
        deviceId: "cliparr-device-1",
      },
    },
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
          location: "http://198.51.100.10/video.mp4",
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

void test("live Jellyfin metadata is shared, handles stay session-owned, and unchanged items are reused", async (context) => {
  const source = createSource();
  const first = createSession();
  const second = createSession();
  const baseFetch = createJellyfinPlaybackFetch({ itemId: "item-1" });
  let metadataCalls = 0;
  let playbackCalls = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = fetchInputUrl(input).pathname;
      if (path.endsWith("/PlaybackInfo")) {
        playbackCalls++;
      } else if (path === "/Items/item-1") {
        metadataCalls++;
      }
      return baseFetch(input, init);
    },
  );
  const row: JellyfinSessionInfo = {
    Id: "live-session",
    UserId: "user-1",
    NowPlayingItem: { Id: "item-1" },
    PlayState: { PositionTicks: 10_000_000 },
  };
  const snapshot = createJellyfinPlaybackResolver(source, createContext());
  const initial = snapshot([row]);
  const [one, two] = await Promise.all([initial(first), initial(second)]);
  assert.equal(metadataCalls, 1);
  assert.equal(playbackCalls, 2);
  assert.notEqual(one[0].item.mediaUrl, two[0].item.mediaUrl);
  assert.ok(first.mediaHandles.has(one[0].item.mediaUrl!.split("/").at(-1)!));
  const paused = await snapshot([
    { ...row, PlayState: { IsPaused: true, PositionTicks: 20_000_000 } },
  ])(first);
  assert.equal(paused[0].item.playerState, "paused");
  assert.equal(paused[0].item.playheadSeconds, 2);
  assert.equal(paused[0].item.mediaUrl, one[0].item.mediaUrl);
  assert.equal(metadataCalls, 1);
  assert.equal(playbackCalls, 2);
  await snapshot([])(first);
  await snapshot([row])(first);
  assert.equal(metadataCalls, 2, "removed sessions evict their metadata");
});

void test("live Jellyfin preparation propagates transient failures and the same resolver can recover", async (context) => {
  const baseFetch = createJellyfinPlaybackFetch({ itemId: "retry-item" });
  let attempts = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (
        fetchInputUrl(input).pathname.endsWith("/PlaybackInfo") &&
        ++attempts === 1
      ) {
        return jsonResponse({ message: "Temporary failure" }, 503);
      }
      return baseFetch(input, init);
    },
  );
  const resolve = createJellyfinPlaybackResolver(
    createSource(),
    createContext(),
  )([
    {
      Id: "retry-session",
      UserId: "user-1",
      NowPlayingItem: { Id: "retry-item" },
    },
  ]);
  const owner = createSession();
  await assert.rejects(resolve(owner));
  const recovered = await resolve(owner);
  assert.ok(recovered[0].item.mediaUrl);
  assert.ok(recovered[0].item.previewUrl);
  assert.equal(attempts, 2);
});

void test("concurrent Jellyfin resolvers share items within one credential scope and keep playback sessions isolated", async (context) => {
  const baseFetch = createJellyfinPlaybackFetch({ itemId: "dedupe-item" });
  let metadataCalls = 0;
  let playbackCalls = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = fetchInputUrl(input).pathname;
      if (path === "/Items/dedupe-item") {
        metadataCalls += 1;
      }
      if (path.endsWith("/PlaybackInfo")) {
        playbackCalls += 1;
      }
      return baseFetch(input, init);
    },
  );
  const rows: JellyfinSessionInfo[] = [
    {
      Id: "dedupe-session",
      UserId: "user-1",
      NowPlayingItem: { Id: "dedupe-item" },
    },
  ];
  const resolve = (providerContext: JellyfinSourceContext) =>
    createJellyfinPlaybackResolver(createSource(), providerContext)(rows);
  const owner = createSession();
  await Promise.all([
    resolve(createContext())(owner),
    resolve(createContext())(owner),
  ]);
  assert.equal(metadataCalls, 1);
  assert.equal(
    playbackCalls,
    1,
    "same owner and playback row share one in-flight setup",
  );

  await Promise.all([
    resolve(createContext())(createSession()),
    resolve({ ...createContext(), token: "different-token" })(createSession()),
  ]);
  assert.equal(
    metadataCalls,
    3,
    "different credentials must not share item responses",
  );
  assert.equal(
    playbackCalls,
    3,
    "different owners must not share playback setup",
  );
});

useProviderFixtures();

for (const [critic, expected] of [
  [85, 8.5],
  [8.5, 8.5],
  [10, 10],
  [null, undefined],
  [101, undefined],
] as const) {
  void test(`Jellyfin export metadata carries external IDs and normalizes critic score ${critic}`, async (context) => {
    context.mock.method(
      globalThis,
      "fetch",
      createJellyfinPlaybackFetch({
        itemId: "metadata-enrichment",
        itemMetadata: {
          ProviderIds: {
            Imdb: "tt0133093",
            Tmdb: "603",
            Tvdb: "123",
            Internal: "private-key",
          },
          CriticRating: critic,
          CommunityRating: 7.6,
        },
      }),
    );
    const entries = await listCurrentlyPlaying(createSession(), createSource());
    const metadata = entries[0]?.item.exportMetadata;
    assert.ok(metadata);
    assert.deepEqual(metadata.externalIds, {
      imdb: "tt0133093",
      tmdb: "603",
      tvdb: "123",
    });
    assert.equal(metadata.criticRating, expected);
    assert.equal(metadata.audienceRating, 7.6);
  });
}
