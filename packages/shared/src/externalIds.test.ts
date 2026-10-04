import assert from "node:assert/strict";
import test from "node:test";
import { parseExternalIds } from "#external-ids";

void test("parses modern scheme://id URIs", () => {
  assert.deepEqual(parseExternalIds(["imdb://tt0133093", "tmdb://603"]), {
    imdb: "tt0133093",
    tmdb: "603",
  });
});

void test("parses Jellyfin-style lowercase provider IDs", () => {
  assert.deepEqual(
    parseExternalIds(["imdb://tt0133093", "tvdb://205361", "tmdb://603"]),
    { imdb: "tt0133093", tmdb: "603", tvdb: "205361" },
  );
});

void test("parses legacy Plex agent URIs and strips query strings", () => {
  assert.deepEqual(
    parseExternalIds(["com.plexapp.agents.imdb://tt0133093?lang=en"]),
    { imdb: "tt0133093" },
  );
});

void test("first valid ID wins per scheme", () => {
  assert.deepEqual(parseExternalIds(["imdb://tt0133093", "imdb://tt9999999"]), {
    imdb: "tt0133093",
  });
});

void test("ignores unknown schemes and provider-internal URIs", () => {
  assert.equal(
    parseExternalIds(["plex://movie/5d77688b8a7580455c9055ea"]),
    undefined,
  );
});

void test("rejects malformed IDs", () => {
  assert.equal(parseExternalIds(["imdb://not-an-id"]), undefined);
  assert.equal(parseExternalIds(["tmdb://abc"]), undefined);
  assert.equal(parseExternalIds(["imdb://"]), undefined);
  assert.equal(parseExternalIds(["just-a-string"]), undefined);
});

void test("returns undefined when nothing is found", () => {
  assert.equal(parseExternalIds(undefined), undefined);
  assert.equal(parseExternalIds([]), undefined);
});

void test("recognizes only supported schemes and Plex agent prefixes", () => {
  assert.equal(
    parseExternalIds(["private.imdb://tt123", "custom.tmdb://123"]),
    undefined,
  );
  assert.deepEqual(
    parseExternalIds([
      " IMDB://tt123?lang=en ",
      "com.plexapp.agents.tmdb://456",
      "com.plexapp.agents.tvdb://789",
    ]),
    { imdb: "tt123", tmdb: "456", tvdb: "789" },
  );
});

void test("invalid IDs do not prevent a later valid ID from winning", () => {
  assert.deepEqual(
    parseExternalIds([
      "imdb://bad",
      "imdb://tt123",
      "tvdb://bad",
      "tvdb://456",
      "tmdb://bad",
      "tmdb://789",
      "tvdb://999",
    ]),
    { imdb: "tt123", tmdb: "789", tvdb: "456" },
  );
  assert.equal(
    parseExternalIds([
      "tmdb://123/path",
      "tvdb://-123",
      "imdb://tt123#fragment",
    ]),
    undefined,
  );
});
