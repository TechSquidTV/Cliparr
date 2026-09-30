import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapPlex } from "#bootstrap";

const library = {
  name: "Contract Movies",
  type: "movie",
  location: "/data/movies",
  agent: "tv.plex.agents.movie",
  scanner: "Plex Movie",
  language: "en-US",
};
for (const emptySections of [{ size: 0 }, { size: 0, Directory: [] }]) {
  void test(`bootstrap waits, creates, and is idempotent with ${JSON.stringify(emptySections)}`, async () => {
    let ready = false;
    let created = false;
    let creates = 0;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      assert.equal(request.headers.get("accept"), "application/json");
      if (!ready) {
        ready = true;
        return new Response(null, { status: 503 });
      }
      if (url.pathname === "/identity") {
        return Response.json({ MediaContainer: {} });
      }
      assert.equal(url.pathname, "/library/sections");
      if (request.method === "POST") {
        assert.deepEqual(Object.fromEntries(url.searchParams), library);
        creates += 1;
        created = true;
        return Response.json({ MediaContainer: {} });
      }
      return Response.json({
        MediaContainer: created
          ? { Directory: [{ title: library.name }] }
          : emptySections,
      });
    };
    const options = {
      baseUrl: "http://plex.test",
      library,
      fetch,
      attempts: 3,
      intervalMs: 0,
    };
    assert.equal(await bootstrapPlex(options), "created");
    assert.equal(await bootstrapPlex(options), "exists");
    assert.equal(creates, 1);
  });
}
void test("bootstrap failures are bounded and visible", async () => {
  let attempts = 0;
  await assert.rejects(
    bootstrapPlex({
      baseUrl: "http://plex.test",
      library,
      attempts: 3,
      intervalMs: 0,
      fetch: async () => {
        attempts += 1;
        return new Response(null, { status: 503 });
      },
    }),
    /readiness limit/,
  );
  assert.equal(attempts, 3);
});

void test("bootstrap rejects a missing sections container", async () => {
  let creates = 0;
  await assert.rejects(
    bootstrapPlex({
      baseUrl: "http://plex.test",
      library,
      attempts: 1,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.method === "POST") {
          creates += 1;
        }
        return Response.json({});
      },
    }),
    /readiness limit/,
  );
  assert.equal(creates, 0);
});
