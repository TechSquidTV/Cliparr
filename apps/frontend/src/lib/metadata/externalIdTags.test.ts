/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKeyValueExternalIdTags,
  formatProviderIdForFilename,
} from "@/lib/metadata/externalIdTags";

void test("builds key/value ID tags for Matroska and Vorbis containers", () => {
  assert.deepEqual(
    buildKeyValueExternalIdTags({
      imdb: "tt1234567",
      tmdb: "123",
      tvdb: "456",
    }),
    { IMDB: "tt1234567", TMDB: "123", TVDB: "456" },
  );
  assert.deepEqual(buildKeyValueExternalIdTags({ tmdb: "123" }), {
    TMDB: "123",
  });
  assert.deepEqual(buildKeyValueExternalIdTags(undefined), {});
  assert.deepEqual(buildKeyValueExternalIdTags({}), {});
});

void test("formats provider IDs for filenames using the source convention", () => {
  const ids = { imdb: "tt1234567", tmdb: "123", tvdb: "456" };
  assert.equal(formatProviderIdForFilename(ids, "plex"), "{tmdb-123}");
  assert.equal(formatProviderIdForFilename(ids, "jellyfin"), "[tmdbid-123]");
  assert.equal(
    formatProviderIdForFilename({ imdb: "tt1234567" }, "plex"),
    "{imdb-tt1234567}",
  );
  assert.equal(
    formatProviderIdForFilename({ tvdb: "456" }, "jellyfin"),
    "[tvdbid-456]",
  );
  assert.equal(formatProviderIdForFilename(ids, "local"), undefined);
  assert.equal(formatProviderIdForFilename(ids, undefined), undefined);
  assert.equal(formatProviderIdForFilename(undefined, "plex"), undefined);
  assert.equal(formatProviderIdForFilename({}, "plex"), undefined);
});
