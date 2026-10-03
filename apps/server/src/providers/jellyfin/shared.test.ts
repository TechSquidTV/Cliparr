import assert from "node:assert/strict";
import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { getEventListeners } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createDeferred } from "@/test/deferred";

const {
  assertAllowedJellyfinServerUrl,
  fetchPublicSystemInfo,
  resolveCredentialServerUrl,
} = await (async () => {
  const previous = process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS;
  delete process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS;
  try {
    return await import("@/providers/jellyfin/shared");
  } finally {
    if (previous !== undefined) {
      process.env.CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS = previous;
    }
  }
})();

for (const hostname of [
  "127.0.0.1",
  "localhost",
  "[::1]",
  "[::ffff:127.0.0.1]",
]) {
  void test(`default Jellyfin policy rejects ${hostname} before DNS or fetch`, async (context) => {
    context.mock.method(dns, "lookup", () => assert.fail("DNS must not start"));
    context.mock.method(globalThis, "fetch", () =>
      assert.fail("Fetch must not start"),
    );
    syncBuiltinESMExports();
    context.after(() => {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    });
    await assert.rejects(
      fetchPublicSystemInfo({ baseUrl: `http://${hostname}:8096` }),
      { code: "invalid_jellyfin_server_url" },
    );
  });
}

void test("already-aborted Jellyfin requests skip DNS and fetch", async (context) => {
  context.mock.method(dns, "lookup", () => assert.fail("DNS must not start"));
  context.mock.method(globalThis, "fetch", () =>
    assert.fail("Fetch must not start"),
  );
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const reason = new Error("Cancelled before DNS");
  const signal = AbortSignal.abort(reason);
  await assert.rejects(
    assertAllowedJellyfinServerUrl("http://jellyfin.invalid", {
      allowPrivate: true,
      signal,
    }),
    (error: Error) => error === reason,
  );
  await assert.rejects(
    fetchPublicSystemInfo({ baseUrl: "http://jellyfin.invalid", signal }),
    (error: Error) => error === reason,
  );
});

for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
  void test(`default Jellyfin policy rejects DNS resolving to ${address} before fetch`, async (context) => {
    context.mock.method(dns, "lookup", async () => [
      { address, family: address.includes(":") ? 6 : 4 },
    ]);
    context.mock.method(globalThis, "fetch", () =>
      assert.fail("Fetch must not start"),
    );
    syncBuiltinESMExports();
    context.after(() => {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    });
    await assert.rejects(
      fetchPublicSystemInfo({ baseUrl: "http://jellyfin.invalid:8096" }),
      { code: "invalid_jellyfin_server_url" },
    );
  });
}

for (const scenario of ["caller abort", "timeout", "redirect abort"] as const) {
  void test(
    `Jellyfin ${scenario} stops waiting for DNS without a later fetch`,
    { timeout: 1000 },
    async (context) => {
      context.mock.timers.enable({ apis: ["setTimeout"] });
      const entered = createDeferred<void>();
      const pending = createDeferred<LookupAddress[]>();
      const controller = new AbortController();
      const reason = new Error("Cancelled during DNS");
      context.mock.method(dns, "lookup", () => {
        entered.resolve();
        return pending.promise;
      });
      let fetchCalls = 0;
      context.mock.method(globalThis, "fetch", async () => {
        fetchCalls++;
        assert.equal(scenario, "redirect abort");
        assert.equal(fetchCalls, 1);
        return new Response(null, {
          status: 302,
          headers: { location: "http://redirect.invalid/System/Info/Public" },
        });
      });
      syncBuiltinESMExports();
      context.after(() => {
        controller.abort();
        pending.resolve([{ address: "192.0.2.10", family: 4 }]);
        context.mock.restoreAll();
        syncBuiltinESMExports();
      });
      const request = fetchPublicSystemInfo({
        baseUrl:
          scenario === "redirect abort"
            ? "http://192.0.2.10:8096"
            : "http://jellyfin.invalid:8096",
        signal: controller.signal,
        timeoutMs: 50,
      });
      const rejected = assert.rejects(
        request,
        scenario === "timeout"
          ? { status: 504 }
          : (error: Error) => error === reason,
      );
      await entered.promise;
      if (scenario === "timeout") {
        context.mock.timers.tick(51);
      } else {
        controller.abort(reason);
      }
      await rejected;
      pending.resolve([{ address: "192.0.2.10", family: 4 }]);
      await setImmediate();
      assert.equal(fetchCalls, scenario === "redirect abort" ? 1 : 0);
    },
  );
}

void test("credential URL validation has a bounded DNS wait", async (context) => {
  const entered = createDeferred<void>();
  const pending = createDeferred<LookupAddress[]>();
  const controller = new AbortController();
  const reason = new DOMException("DNS validation timed out", "TimeoutError");
  context.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 5000);
    return controller.signal;
  });
  context.mock.method(dns, "lookup", () => {
    entered.resolve();
    return pending.promise;
  });
  syncBuiltinESMExports();
  context.after(() => {
    controller.abort();
    pending.resolve([]);
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const request = resolveCredentialServerUrl("http://jellyfin.invalid");
  const rejected = assert.rejects(request, {
    status: 504,
    code: "invalid_jellyfin_server_url",
  });
  await entered.promise;
  controller.abort(reason);
  await rejected;
});

for (const outcome of ["success", "failure", "late rejection"] as const) {
  void test(`Jellyfin DNS ${outcome} cleans up its abort listener`, async (context) => {
    const entered = createDeferred<void>();
    const pending = createDeferred<LookupAddress[]>();
    const controller = new AbortController();
    context.mock.method(dns, "lookup", () => {
      entered.resolve();
      return pending.promise;
    });
    syncBuiltinESMExports();
    context.after(() => {
      controller.abort();
      pending.resolve([]);
      context.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const request = assertAllowedJellyfinServerUrl("http://jellyfin.invalid", {
      allowPrivate: true,
      signal: controller.signal,
    });
    const reason = new Error("Cancelled");
    const result =
      outcome === "success"
        ? request
        : assert.rejects(
            request,
            outcome === "failure"
              ? { code: "invalid_jellyfin_server_url" }
              : (error: Error) => error === reason,
          );
    await entered.promise;
    assert.equal(getEventListeners(controller.signal, "abort").length, 1);
    if (outcome === "success") {
      pending.resolve([{ address: "192.0.2.10", family: 4 }]);
    } else if (outcome === "failure") {
      pending.reject(new Error("DNS failed"));
    } else {
      controller.abort(reason);
    }
    await result;
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    if (outcome === "late rejection") {
      pending.reject(new Error("Late DNS failure"));
      await setImmediate();
    }
  });
}
