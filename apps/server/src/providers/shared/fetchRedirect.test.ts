import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  fetchWithManualRedirects,
  type RedirectFetchPolicy,
} from "@/providers/shared/fetchRedirect";
import { closePooledPinnedDnsAgents } from "@/providers/shared/pinnedFetch";

const policy: RedirectFetchPolicy = {
  maxRedirects: 2,
  sensitiveHeaders: ["authorization", "cookie", "x-provider-token"],
  assertRequestUrl: async () => ["192.0.2.10"],
  invalidRedirectError: () => new Error("Invalid redirect"),
  redirectLimitError: () => new Error("Redirect limit"),
};

afterEach(closePooledPinnedDnsAgents);

for (const status of [301, 302, 303, 307, 308]) {
  for (const method of ["POST", "PATCH", "HEAD"]) {
    void test(`${status} redirects preserve the correct ${method} method and body`, async (context) => {
      const signal = new AbortController().signal;
      const payload = method === "HEAD" ? undefined : '{"value":1}';
      const switchesToGet =
        (status === 303 && method !== "HEAD") ||
        ((status === 301 || status === 302) && method === "POST");
      let calls = 0;
      let discarded = false;
      const final = new Response("complete");
      context.mock.method(
        globalThis,
        "fetch",
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          assert.equal(init?.signal, signal);
          assert.equal(init?.redirect, "manual");
          const request = new Request(input, init);
          calls++;
          if (calls === 1) {
            return new Response(
              new ReadableStream({
                cancel() {
                  discarded = true;
                },
              }),
              {
                status,
                headers: { location: "next" },
              },
            );
          }
          assert.equal(calls, 2);
          assert.ok(discarded, "discard the previous body before the next hop");
          assert.equal(request.url, "https://provider.example.test/base/next");
          assert.equal(request.method, switchesToGet ? "GET" : method);
          assert.equal(
            await request.text(),
            switchesToGet ? "" : (payload ?? ""),
          );
          assert.equal(
            request.headers.get("content-type"),
            switchesToGet ? null : "application/json",
          );
          return final;
        },
      );
      const result = await fetchWithManualRedirects(
        "https://provider.example.test/base/start",
        {
          method,
          headers: { "content-type": "application/json" },
          body: payload,
          signal,
        },
        policy,
      );
      assert.equal(result, final);
      assert.equal(await result.text(), "complete");
      assert.equal(calls, 2);
    });
  }
}

void test("cross-origin hops strip credentials permanently while same-origin hops retain them", async (context) => {
  const urls = [
    "https://provider.example.test/start",
    "https://provider.example.test/same-origin",
    "https://other.example.test/away",
    "https://provider.example.test/returned",
  ];
  let calls = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const request = new Request(input, init);
      const index = calls++;
      assert.equal(request.url, urls[index]);
      for (const header of policy.sensitiveHeaders) {
        assert.equal(request.headers.get(header), index < 2 ? "secret" : null);
      }
      assert.equal(request.headers.get("accept"), "application/json");
      return index === urls.length - 1
        ? Response.json({ ok: true })
        : new Response(null, {
            status: 302,
            headers: { location: urls[index + 1] },
          });
    },
  );
  const checked: string[] = [];
  const signal = new AbortController().signal;
  await fetchWithManualRedirects(
    urls[0],
    {
      signal,
      headers: {
        authorization: "secret",
        cookie: "secret",
        "x-provider-token": "secret",
        accept: "application/json",
      },
    },
    {
      ...policy,
      maxRedirects: 3,
      assertRequestUrl: async (url, trustedOrigin, actualSignal) => {
        assert.equal(trustedOrigin, new URL(urls[0]).origin);
        assert.equal(actualSignal, signal);
        checked.push(url.toString());
        return ["192.0.2.10"];
      },
    },
  );
  assert.deepEqual(checked, urls);
  assert.equal(calls, urls.length);
});

void test("malformed redirects discard their body without masking the provider error", async (context) => {
  let discarded = false;
  const failure = new Error("Provider invalid redirect");
  const fetch = context.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            discarded = true;
            throw new Error("Already consumed");
          },
        }),
        { status: 302, headers: { location: "http://[" } },
      ),
  );
  await assert.rejects(
    fetchWithManualRedirects("https://provider.example.test/start", undefined, {
      ...policy,
      invalidRedirectError: () => failure,
    }),
    (error: Error) => error === failure,
  );
  assert.ok(discarded);
  assert.equal(fetch.mock.callCount(), 1);
});

void test("redirect limits discard the last body and do not fetch another hop", async (context) => {
  let discarded = 0;
  const fetch = context.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            discarded++;
          },
        }),
        { status: 302, headers: { location: "/again" } },
      ),
  );
  const failure = new Error("Provider redirect limit");
  await assert.rejects(
    fetchWithManualRedirects("https://provider.example.test/start", undefined, {
      ...policy,
      redirectLimitError: () => failure,
    }),
    (error: Error) => error === failure,
  );
  assert.equal(fetch.mock.callCount(), policy.maxRedirects + 1);
  assert.equal(discarded, policy.maxRedirects + 1);
});

void test("a rejected destination is never fetched and its preceding response is discarded", async (context) => {
  let discarded = false;
  const failure = new Error("Provider URL rejected");
  const fetch = context.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            discarded = true;
          },
        }),
        {
          status: 302,
          headers: { location: "https://rejected.example.test/" },
        },
      ),
  );
  await assert.rejects(
    fetchWithManualRedirects("https://provider.example.test/start", undefined, {
      ...policy,
      assertRequestUrl: async (url) => {
        if (url.hostname === "rejected.example.test") {
          assert.ok(discarded);
          throw failure;
        }
        return ["192.0.2.10"];
      },
    }),
    (error: Error) => error === failure,
  );
  assert.equal(fetch.mock.callCount(), 1);
});

void test("already-aborted callers skip validation and fetch", async (context) => {
  context.mock.method(globalThis, "fetch", () =>
    assert.fail("Fetch must not start"),
  );
  const reason = new Error("Cancelled");
  await assert.rejects(
    fetchWithManualRedirects(
      "https://provider.example.test/start",
      {
        signal: AbortSignal.abort(reason),
      },
      {
        ...policy,
        assertRequestUrl: async () => assert.fail("Validation must not start"),
      },
    ),
    (error: Error) => error === reason,
  );
});
