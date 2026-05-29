/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { cliparrClient, subscribeToAuthFailure } from "./cliparrClient";

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

async function withMockedFetch<T>(
  handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
  action: () => Promise<T>
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;

  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void test("handles 204 responses without trying to parse JSON", async () => {
  await withMockedFetch(async (input, init) => {
    assert.equal(input, "/api/session");
    assert.equal(init?.method, "DELETE");
    return new Response(null, { status: 204 });
  }, async () => {
    await cliparrClient.logout();
  });
});

void test("reports app-page responses as API configuration errors", async () => {
  await withMockedFetch(async () => {
    return new Response("<!doctype html><title>Cliparr</title>", {
      status: 200,
      headers: {
        "content-type": "text/html",
      },
    });
  }, async () => {
    await assert.rejects(
      () => cliparrClient.getHealth(),
      /Cliparr API returned the app page instead of JSON/
    );
  });
});

void test("surfaces JSON API errors and coalesces auth failure notifications", async () => {
  await withMockedFetch(async () => {
    return jsonResponse({
      error: {
        code: "not_authenticated",
        message: "Sign in with a provider first",
      },
    }, {
      status: 401,
      statusText: "Unauthorized",
    });
  }, async () => {
    let authFailureCount = 0;
    const unsubscribe = subscribeToAuthFailure(() => {
      authFailureCount += 1;
    });

    try {
      const results = await Promise.allSettled([
        cliparrClient.getSession(),
        cliparrClient.listSources(),
      ]);

      assert.equal(results[0]?.status, "rejected");
      assert.equal(results[1]?.status, "rejected");
      const error = results[0]?.status === "rejected" ? results[0].reason as Error & { status?: number; code?: string } : undefined;
      assert.equal(error?.name, "CliparrRequestError");
      assert.equal(error?.message, "Sign in with a provider first");
      assert.equal(error?.status, 401);
      assert.equal(error?.code, "not_authenticated");

      await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
      assert.equal(authFailureCount, 1);
    } finally {
      unsubscribe();
    }
  });
});

void test("follows app auth redirects with the current browser location", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let assignedUrl = "";

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        origin: "http://cliparr.test",
        pathname: "/dashboard",
        search: "?tab=sources",
        hash: "#top",
        assign(url: string) {
          assignedUrl = url;
        },
      },
    },
  });

  try {
    await withMockedFetch(async () => {
      return {
        redirected: true,
        url: "http://cliparr.test/api/auth/plex?state=abc",
      } as Response;
    }, async () => {
      void cliparrClient.getHealth();
      await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
      assert.equal(
        assignedUrl,
        "http://cliparr.test/api/auth/plex?state=abc&redirectUrl=%2Fdashboard%3Ftab%3Dsources%23top"
      );
    });
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
});
