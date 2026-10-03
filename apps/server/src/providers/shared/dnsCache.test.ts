import { TEST_PUBLIC_ADDRESS } from "@/test/providerFixtures";
import { PRIVATE_IPV4_ADDRESSES } from "@/test/networkPolicyFixtures";
import assert from "node:assert/strict";
import type { LookupAddress } from "node:dns";
import { getEventListeners } from "node:events";
import { setImmediate } from "node:timers/promises";
import { createDeferred } from "@/test/deferred";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { resolveHostnameAddresses } from "@/providers/shared/dnsCache";

void test("concurrent resolutions share one lookup", async (context) => {
  let lookups = 0;
  context.mock.method(dns, "lookup", async () => {
    lookups += 1;
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    return [{ address: TEST_PUBLIC_ADDRESS, family: 4 }];
  });
  syncBuiltinESMExports();
  try {
    const [a, b] = await Promise.all([
      resolveHostnameAddresses("example.test", new AbortController().signal),
      resolveHostnameAddresses("example.test", new AbortController().signal),
    ]);
    assert.deepEqual(a, [TEST_PUBLIC_ADDRESS]);
    assert.deepEqual(b, [TEST_PUBLIC_ADDRESS]);
    assert.equal(lookups, 1);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

void test("resolved addresses are cached within the TTL", async (context) => {
  let lookups = 0;
  context.mock.method(dns, "lookup", async () => {
    lookups += 1;
    return [{ address: TEST_PUBLIC_ADDRESS, family: 4 }];
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(
      await resolveHostnameAddresses(
        "cached.test",
        new AbortController().signal,
      ),
      [TEST_PUBLIC_ADDRESS],
    );
    assert.deepEqual(
      await resolveHostnameAddresses(
        "cached.test",
        new AbortController().signal,
      ),
      [TEST_PUBLIC_ADDRESS],
    );
    assert.equal(lookups, 1);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

void test("IP literals resolve without a lookup", async (context) => {
  let lookups = 0;
  context.mock.method(dns, "lookup", async () => {
    lookups += 1;
    return [];
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(
      await resolveHostnameAddresses(
        PRIVATE_IPV4_ADDRESSES[0],
        new AbortController().signal,
      ),
      [],
    );
    assert.deepEqual(
      await resolveHostnameAddresses("::1", new AbortController().signal),
      [],
    );
    assert.equal(lookups, 0);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

void test("lookup failures propagate and are not cached", async (context) => {
  let lookups = 0;
  context.mock.method(dns, "lookup", async () => {
    lookups += 1;
    throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      resolveHostnameAddresses("missing.test", new AbortController().signal),
      /ENOTFOUND/,
    );
    await assert.rejects(
      resolveHostnameAddresses("missing.test", new AbortController().signal),
      /ENOTFOUND/,
    );
    assert.equal(lookups, 2);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

void test("duplicate and IPv4-mapped addresses are normalized", async (context) => {
  context.mock.method(dns, "lookup", async () => {
    return [
      { address: TEST_PUBLIC_ADDRESS, family: 4 },
      { address: TEST_PUBLIC_ADDRESS, family: 4 },
      // IPv4-mapped form of TEST_PUBLIC_ADDRESS (192.0.2.10).
      { address: "::ffff:c000:020a", family: 6 },
    ];
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(
      await resolveHostnameAddresses(
        "mapped.test",
        new AbortController().signal,
      ),
      [TEST_PUBLIC_ADDRESS],
    );
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

void test("TTL expires at 60 seconds and callers cannot mutate cached answers", async (context) => {
  let now = Date.now();
  let lookups = 0;
  context.mock.method(Date, "now", () => now);
  context.mock.method(dns, "lookup", async () => {
    lookups += 1;
    return [{ address: `192.0.2.${lookups}`, family: 4 }];
  });
  syncBuiltinESMExports();
  try {
    const signal = new AbortController().signal;
    const first = await resolveHostnameAddresses("ttl.test", signal);
    first.push("127.0.0.1");
    now += 59_999;
    assert.deepEqual(await resolveHostnameAddresses("TTL.test.", signal), [
      "192.0.2.1",
    ]);
    assert.equal(lookups, 1);
    now += 1;
    assert.deepEqual(await resolveHostnameAddresses("ttl.test", signal), [
      "192.0.2.2",
    ]);
    assert.equal(lookups, 2);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

void test("already-aborted signals reject even for a cache hit or IP literal", async (context) => {
  let lookups = 0;
  context.mock.method(dns, "lookup", async () => {
    lookups += 1;
    return [{ address: TEST_PUBLIC_ADDRESS, family: 4 }];
  });
  syncBuiltinESMExports();
  try {
    await resolveHostnameAddresses(
      "aborted-cache.test",
      new AbortController().signal,
    );
    const reason = new Error("Already cancelled");
    for (const hostname of [
      "aborted-cache.test",
      "127.0.0.1",
      "uncached-aborted.test",
    ]) {
      await assert.rejects(
        resolveHostnameAddresses(hostname, AbortSignal.abort(reason)),
        (error: Error) => error === reason,
      );
    }
    assert.equal(lookups, 1);
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

for (const cancelledCaller of ["first", "second"] as const) {
  void test(`aborting the ${cancelledCaller} caller does not cancel shared DNS for the other`, async (context) => {
    const pending = createDeferred<LookupAddress[]>();
    let lookups = 0;
    context.mock.method(dns, "lookup", () => {
      lookups += 1;
      return pending.promise;
    });
    syncBuiltinESMExports();
    const first = new AbortController();
    const second = new AbortController();
    try {
      const hostname = `independent-${cancelledCaller}.test`;
      const one = resolveHostnameAddresses(hostname, first.signal);
      const two = resolveHostnameAddresses(hostname, second.signal);
      assert.equal(lookups, 1);
      assert.equal(getEventListeners(first.signal, "abort").length, 1);
      assert.equal(getEventListeners(second.signal, "abort").length, 1);
      const reason = new Error("Cancelled during DNS");
      const rejected = assert.rejects(
        cancelledCaller === "first" ? one : two,
        (error: Error) => error === reason,
      );
      (cancelledCaller === "first" ? first : second).abort(reason);
      await rejected;
      pending.resolve([{ address: TEST_PUBLIC_ADDRESS, family: 4 }]);
      assert.deepEqual(await (cancelledCaller === "first" ? two : one), [
        TEST_PUBLIC_ADDRESS,
      ]);
      assert.equal(getEventListeners(first.signal, "abort").length, 0);
      assert.equal(getEventListeners(second.signal, "abort").length, 0);
    } finally {
      first.abort();
      second.abort();
      pending.resolve([]);
      context.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}

for (const outcome of [
  "success",
  "failure",
  "abort",
  "late rejection",
] as const) {
  void test(`DNS ${outcome} cleans listeners and only successful active callers populate the cache`, async (context) => {
    const pending = createDeferred<LookupAddress[]>();
    let lookups = 0;
    context.mock.method(dns, "lookup", () => {
      lookups += 1;
      return lookups === 1
        ? pending.promise
        : Promise.resolve([{ address: "192.0.2.11", family: 4 }]);
    });
    syncBuiltinESMExports();
    const controller = new AbortController();
    try {
      const hostname = `cleanup-${outcome}.test`;
      const request = resolveHostnameAddresses(hostname, controller.signal);
      assert.equal(getEventListeners(controller.signal, "abort").length, 1);
      const completion =
        outcome === "success" ? request : assert.rejects(request);
      if (outcome === "success") {
        pending.resolve([{ address: TEST_PUBLIC_ADDRESS, family: 4 }]);
      } else if (outcome === "failure") {
        pending.reject(new Error("DNS failed"));
      } else {
        controller.abort();
      }
      await completion;
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
      if (outcome === "late rejection") {
        pending.reject(new Error("DNS failed after abort"));
      } else {
        pending.resolve([{ address: TEST_PUBLIC_ADDRESS, family: 4 }]);
      }
      await setImmediate();
      await resolveHostnameAddresses(hostname, new AbortController().signal);
      assert.equal(lookups, outcome === "success" ? 1 : 2);
    } finally {
      controller.abort();
      pending.resolve([]);
      context.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}
