/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { MediaSource, MediaSourceCheckResult } from "@/providers/types";
import {
  buildSourceEditInput,
  draftBaseUrlsFor,
  draftNamesFor,
  filterSources,
  mergeRefreshAllSourceResults,
  sourceCounts,
  sourceProviderOptions,
} from "@/components/sources/sourcesStateUtilities";

function source(
  overrides: Partial<MediaSource> &
    Pick<MediaSource, "id" | "name" | "providerId">,
): MediaSource {
  return {
    enabled: true,
    baseUrl: `https://${overrides.id}.example.test`,
    metadata: {},
    lastCheckedAt: null,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const alpha = source({
  id: "alpha",
  providerId: "demo",
  name: "Alpha",
  metadata: {
    product: "Example Server",
    platform: "macOS",
  },
  lastCheckedAt: "2026-01-01T00:00:00.000Z",
});
const beta = source({
  id: "beta",
  providerId: "other",
  name: "Beta",
  enabled: false,
});
const gamma = source({
  id: "gamma",
  providerId: "demo",
  name: "Gamma",
  lastError: "Offline",
});
const sources = [gamma, beta, alpha];

void test("builds source drafts, counts, and provider options", () => {
  assert.deepEqual(draftBaseUrlsFor(sources), {
    alpha: alpha.baseUrl,
    beta: beta.baseUrl,
    gamma: gamma.baseUrl,
  });
  assert.deepEqual(draftNamesFor(sources), {
    alpha: "Alpha",
    beta: "Beta",
    gamma: "Gamma",
  });
  assert.deepEqual(sourceCounts(sources), {
    all: 3,
    enabled: 2,
    disabled: 1,
    attention: 1,
  });
  assert.deepEqual(sourceProviderOptions(sources), ["demo", "other"]);
});

void test("filters sources by provider, status, and query metadata", () => {
  assert.deepEqual(
    filterSources({
      sources,
      providerFilter: "demo",
      statusFilter: "all",
      query: "",
    }).map((item) => item.id),
    ["gamma", "alpha"],
  );

  assert.deepEqual(
    filterSources({
      sources,
      providerFilter: "all",
      statusFilter: "disabled",
      query: "",
    }).map((item) => item.id),
    ["beta"],
  );

  assert.deepEqual(
    filterSources({
      sources,
      providerFilter: "all",
      statusFilter: "attention",
      query: "",
    }).map((item) => item.id),
    ["gamma"],
  );

  assert.deepEqual(
    filterSources({
      sources,
      providerFilter: "all",
      statusFilter: "enabled",
      query: "macos",
    }).map((item) => item.id),
    ["alpha"],
  );
});

void test("builds trimmed source edit payloads only for changed fields", () => {
  assert.deepEqual(
    buildSourceEditInput(
      alpha,
      {
        alpha: " Alpha ",
      },
      {
        alpha: `${alpha.baseUrl}   `,
      },
    ),
    {},
  );

  assert.deepEqual(
    buildSourceEditInput(
      alpha,
      {
        alpha: "  Alpha Renamed  ",
      },
      {
        alpha: " https://alpha-new.example.test ",
      },
    ),
    {
      name: "Alpha Renamed",
      baseUrl: "https://alpha-new.example.test",
    },
  );

  assert.deepEqual(
    buildSourceEditInput(
      alpha,
      {
        alpha: "   ",
      },
      {
        alpha: "   ",
      },
    ),
    {},
  );
});

void test("merges refresh-all results and summarizes partial failures", () => {
  const alphaHealthy = {
    ...alpha,
    name: "Alpha Healthy",
    lastError: null,
    lastCheckedAt: "2026-01-02T00:00:00.000Z",
  };
  const gammaAttention = {
    ...gamma,
    lastError: "Still offline",
    lastCheckedAt: "2026-01-02T00:00:00.000Z",
  };
  const results: Array<
    PromiseSettledResult<{
      source: MediaSource;
      result: MediaSourceCheckResult;
    }>
  > = [
    {
      status: "fulfilled",
      value: {
        source: gamma,
        result: {
          ok: false,
          source: gammaAttention,
          error: {
            message: "Still offline",
          },
        },
      },
    },
    {
      status: "rejected",
      reason: new Error("Network failed"),
    },
    {
      status: "fulfilled",
      value: {
        source: alpha,
        result: {
          ok: true,
          source: alphaHealthy,
        },
      },
    },
  ];

  const merged = mergeRefreshAllSourceResults(sources, results);

  assert.deepEqual(
    merged.sources.map((item) => item.name),
    ["Alpha Healthy", "Gamma", "Beta"],
  );
  assert.deepEqual(merged.feedback, {
    tone: "warning",
    message: "Refreshed 3 sources. 1 healthy, 1 need attention, 1 failed.",
  });
});
