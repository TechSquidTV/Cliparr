import assert from "node:assert/strict";
import test from "node:test";
import {
  createVersionInfoService,
  parseStableSemverTag,
} from "@/config/versionInfo";

const CHECKED_AT = Date.parse("2026-06-04T12:00:00.000Z");
const RELEASE_URL =
  "https://github.com/TechSquidTV/Cliparr/releases/tag/v1.3.0";

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function releasePayload(tagName: string) {
  return {
    tag_name: tagName,
    html_url: RELEASE_URL.replace("v1.3.0", tagName),
    published_at: "2026-06-04T10:30:00.000Z",
  };
}

void test("parses only stable semver release tags", () => {
  assert.deepEqual(parseStableSemverTag("v1.2.3"), {
    major: 1,
    minor: 2,
    patch: 3,
  });
  assert.deepEqual(parseStableSemverTag("1.2.3"), {
    major: 1,
    minor: 2,
    patch: 3,
  });
  assert.equal(parseStableSemverTag("v1.2.3-beta.1"), undefined);
  assert.equal(parseStableSemverTag("main@abc1234"), undefined);
});

void test("reports update availability from the latest stable release", async () => {
  const service = createVersionInfoService({
    currentVersion: "v1.2.3",
    now: () => CHECKED_AT,
    fetchImpl: async (input, init) => {
      assert.match(input, /\/releases\/latest$/u);
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.Accept,
        "application/vnd.github+json",
      );
      return jsonResponse(releasePayload("v1.3.0"));
    },
  });

  assert.deepEqual(await service.getVersionInfo(), {
    currentVersion: "v1.2.3",
    latestRelease: {
      tagName: "v1.3.0",
      url: RELEASE_URL,
      publishedAt: "2026-06-04T10:30:00.000Z",
    },
    updateAvailable: true,
    checkedAt: "2026-06-04T12:00:00.000Z",
    status: "update_available",
  });
});

void test("treats current or newer installed versions as current", async () => {
  const service = createVersionInfoService({
    currentVersion: "v1.3.0",
    now: () => CHECKED_AT,
    fetchImpl: async () => jsonResponse(releasePayload("v1.2.9")),
  });

  assert.deepEqual(await service.getVersionInfo(), {
    currentVersion: "v1.3.0",
    latestRelease: {
      tagName: "v1.2.9",
      url: RELEASE_URL.replace("v1.3.0", "v1.2.9"),
      publishedAt: "2026-06-04T10:30:00.000Z",
    },
    updateAvailable: false,
    checkedAt: "2026-06-04T12:00:00.000Z",
    status: "current",
  });
});

void test("does not call GitHub for non-release current versions", async () => {
  let fetchCount = 0;
  const service = createVersionInfoService({
    currentVersion: "main@abc1234",
    now: () => CHECKED_AT,
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(releasePayload("v1.3.0"));
    },
  });

  assert.deepEqual(await service.getVersionInfo(), {
    currentVersion: "main@abc1234",
    updateAvailable: false,
    status: "unknown",
  });
  assert.equal(fetchCount, 0);
});

void test("caches successful release checks", async () => {
  let fetchCount = 0;
  let now = CHECKED_AT;
  const service = createVersionInfoService({
    currentVersion: "v1.2.3",
    now: () => now,
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(releasePayload("v1.3.0"));
    },
  });

  assert.equal(
    (await service.getVersionInfo()).checkedAt,
    "2026-06-04T12:00:00.000Z",
  );
  now += 12 * 60 * 60 * 1000 - 1;
  assert.equal(
    (await service.getVersionInfo()).checkedAt,
    "2026-06-04T12:00:00.000Z",
  );
  assert.equal(fetchCount, 1);

  now += 2;
  assert.equal(
    (await service.getVersionInfo()).checkedAt,
    "2026-06-05T00:00:00.001Z",
  );
  assert.equal(fetchCount, 2);
});

void test("caches failures until GitHub retry headers expire", async () => {
  let fetchCount = 0;
  let now = CHECKED_AT;
  const service = createVersionInfoService({
    currentVersion: "v1.2.3",
    now: () => now,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response("rate limited", {
        status: 403,
        headers: {
          "retry-after": "120",
        },
      });
    },
  });

  assert.deepEqual(await service.getVersionInfo(), {
    currentVersion: "v1.2.3",
    updateAvailable: false,
    checkedAt: "2026-06-04T12:00:00.000Z",
    status: "unavailable",
  });

  now += 119_000;
  assert.equal(
    (await service.getVersionInfo()).checkedAt,
    "2026-06-04T12:00:00.000Z",
  );
  assert.equal(fetchCount, 1);

  now += 2_000;
  assert.equal(
    (await service.getVersionInfo()).checkedAt,
    "2026-06-04T12:02:01.000Z",
  );
  assert.equal(fetchCount, 2);
});

void test("times out stalled release checks and caches the failure", async () => {
  let fetchCount = 0;
  let abortObserved = false;
  const service = createVersionInfoService({
    currentVersion: "v1.2.3",
    now: () => CHECKED_AT,
    releaseCheckTimeoutMs: 1,
    fetchImpl: async (_input, init) => {
      fetchCount += 1;
      assert(init?.signal);

      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          abortObserved = true;
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error("aborted"));
        });
      });
    },
  });

  assert.deepEqual(await service.getVersionInfo(), {
    currentVersion: "v1.2.3",
    updateAvailable: false,
    checkedAt: "2026-06-04T12:00:00.000Z",
    status: "unavailable",
  });
  assert.equal(fetchCount, 1);
  assert.equal(abortObserved, true);

  assert.equal(
    (await service.getVersionInfo()).checkedAt,
    "2026-06-04T12:00:00.000Z",
  );
  assert.equal(fetchCount, 1);
});

void test("coalesces concurrent stale release checks", async () => {
  let fetchCount = 0;
  let resolveFetch: ((response: Response) => void) | undefined;
  const service = createVersionInfoService({
    currentVersion: "v1.2.3",
    now: () => CHECKED_AT,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    },
  });

  const firstRequest = service.getVersionInfo();
  const secondRequest = service.getVersionInfo();

  assert.equal(fetchCount, 1);
  resolveFetch?.(jsonResponse(releasePayload("v1.3.0")));

  const [first, second] = await Promise.all([firstRequest, secondRequest]);
  assert.equal(first.status, "update_available");
  assert.deepEqual(first, second);
  assert.equal(fetchCount, 1);
});
