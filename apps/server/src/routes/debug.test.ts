import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "@/app";
import { closeDatabase } from "@/db/database";
import { upsertMediaSource } from "@/db/mediaSourcesRepository";
import { upsertProviderAccountByAccessToken } from "@/db/providerAccountsRepository";
import { createCliparrPlexTranscodeSessionId } from "@/providers/plex/playback";
import { createProviderSession, getSessionCookieName } from "@/session/store";

const TEST_APP_KEY = "debug-route-test-key-with-32-chars";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function withDebugApp<T>(
  options: { probeEnabled?: boolean },
  callback: (baseUrl: string) => Promise<T>,
) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cliparr-debug-"));
  const previousAppKey = process.env.APP_KEY;
  const previousDataDir = process.env.CLIPARR_DATA_DIR;
  const previousProbeFlag = process.env.CLIPARR_ENABLE_PLEX_HLS_PROBE;

  process.env.APP_KEY = TEST_APP_KEY;
  process.env.CLIPARR_DATA_DIR = dataDir;
  if (options.probeEnabled) {
    process.env.CLIPARR_ENABLE_PLEX_HLS_PROBE = "1";
  } else {
    delete process.env.CLIPARR_ENABLE_PLEX_HLS_PROBE;
  }

  const { app } = await createApp();
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => {
      server.once("listening", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    closeDatabase();
    restoreEnv("APP_KEY", previousAppKey);
    restoreEnv("CLIPARR_DATA_DIR", previousDataDir);
    restoreEnv("CLIPARR_ENABLE_PLEX_HLS_PROBE", previousProbeFlag);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function fetchInputUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

void test("hides the Plex HLS probe unless explicitly enabled", async () => {
  await withDebugApp({ probeEnabled: false }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/debug/plex/hls-probe`, {
      method: "POST",
    });

    assert.equal(response.status, 404);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "debug_not_found");
  });
});

void test("probes Plex HLS root and segment header candidates", async () => {
  await withDebugApp({ probeEnabled: true }, async (baseUrl) => {
    const account = upsertProviderAccountByAccessToken({
      providerId: "plex",
      label: "Plex Account",
      accessToken: "user-token",
    });
    assert.ok(account);
    const source = upsertMediaSource({
      providerId: "plex",
      providerAccountId: account.id,
      externalId: "plex-server-1",
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
    });
    assert.ok(source);
    const session = createProviderSession({
      providerId: "plex",
      providerAccountId: account.id,
      userToken: "user-token",
    });
    const cliparrTranscodeSessionId = createCliparrPlexTranscodeSessionId(
      source.id,
      "259",
    );
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input, init) => {
      const requestUrl = fetchInputUrl(input);
      if (requestUrl.startsWith(baseUrl)) {
        return originalFetch(input, init);
      }

      const url = new URL(requestUrl);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-plex-token"), "provider-token");

      if (url.pathname === "/status/sessions") {
        return Response.json({
          MediaContainer: {
            Metadata: [
              {
                ratingKey: "14449",
                key: "/library/metadata/14449",
                sessionKey: "259",
                type: "episode",
                title: "Aliens of London (1)",
                Session: {
                  id: "client-playback-session-1",
                  location: "lan",
                },
                Player: {
                  machineIdentifier: "player-machine-1",
                  platform: "Chrome",
                  product: "Plex Web",
                  title: "Chrome",
                  state: "paused",
                },
              },
            ],
          },
        });
      }

      if (url.pathname === "/library/metadata/14449") {
        return Response.json({
          MediaContainer: {
            Metadata: [
              {
                ratingKey: "14449",
                key: "/library/metadata/14449",
                type: "episode",
                Media: [
                  {
                    id: "19136",
                    selected: 1,
                    Part: [
                      {
                        id: "28746",
                        selected: 1,
                        Stream: [
                          {
                            id: "101156",
                            streamType: 1,
                            codec: "h264",
                            selected: 1,
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
      }

      if (url.pathname === "/video/:/transcode/universal/start.m3u8") {
        if (
          headers.get("x-plex-session-identifier") !==
          "client-playback-session-1"
        ) {
          return new Response("bad header", { status: 400 });
        }

        return new Response(
          [
            "#EXTM3U",
            "#EXT-X-TARGETDURATION:4",
            "#EXTINF:4,",
            `session/${cliparrTranscodeSessionId}/base/00000.ts`,
          ].join("\n"),
          {
            status: 200,
            headers: {
              "content-type": "application/vnd.apple.mpegurl",
            },
          },
        );
      }

      if (
        url.pathname ===
        `/video/:/transcode/universal/session/${cliparrTranscodeSessionId}/base/00000.ts`
      ) {
        if (
          headers.get("x-plex-session-identifier") !==
          "client-playback-session-1"
        ) {
          return new Response("segment not found", { status: 404 });
        }

        return new Response("segment", {
          status: 200,
          headers: {
            "content-type": "video/mp2t",
          },
        });
      }

      throw new Error(`Unexpected request: ${requestUrl}`);
    }) as typeof fetch;

    try {
      const response = await originalFetch(
        `${baseUrl}/api/debug/plex/hls-probe`,
        {
          method: "POST",
          headers: {
            cookie: `${getSessionCookieName()}=${session.id}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ sourceId: source.id }),
        },
      );

      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        identities?: Record<string, string | null>;
        candidates?: Array<{
          candidate: string;
          status: number;
          firstMediaPath?: string | null;
          firstMediaSegmentSessionId?: string | null;
          segmentResults?: Array<{ candidate: string; status: number }>;
        }>;
      };
      const serialized = JSON.stringify(body);
      assert.equal(serialized.includes("provider-token"), false);
      assert.equal(body.identities?.["plex.session.key"], "259");
      assert.equal(
        body.identities?.["plex.session.id"],
        "client-playback-session-1",
      );

      const sessionIdCandidate = body.candidates?.find(
        (candidate) => candidate.candidate === "Session.id",
      );
      assert.equal(sessionIdCandidate?.status, 200);
      assert.equal(
        sessionIdCandidate?.firstMediaPath,
        `/video/:/transcode/universal/session/${cliparrTranscodeSessionId}/base/00000.ts`,
      );
      assert.equal(
        sessionIdCandidate?.firstMediaSegmentSessionId,
        cliparrTranscodeSessionId,
      );
      assert.equal(
        sessionIdCandidate?.segmentResults?.find(
          (candidate) => candidate.candidate === "Session.id",
        )?.status,
        200,
      );

      assert.equal(
        body.candidates?.find(
          (candidate) => candidate.candidate === "sessionKey",
        )?.status,
        400,
      );
      assert.equal(
        sessionIdCandidate?.segmentResults?.find(
          (candidate) => candidate.candidate === "sessionKey",
        )?.status,
        404,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
