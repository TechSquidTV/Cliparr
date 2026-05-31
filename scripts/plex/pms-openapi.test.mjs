import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPmsOpenApiSpec,
  extractRedocState,
  manifestDiffsForSpec,
  stableJson,
} from "./pms-openapi.mjs";

const fixtureHtml = `<html><body><script>const __redoc_state = {"spec":{"data":{"openapi":"3.1.0","info":{"version":"1.2.2\\n","title":"Plex Media Server"},"paths":{"/identity":{"get":{"description":"returns { identity }"}}}}}};</script></body></html>`;

void test("extracts Plex Redoc state from the PMS API page HTML", () => {
  const state = extractRedocState(fixtureHtml);

  assert.equal(state.spec.data.info.title, "Plex Media Server");
  assert.equal(
    state.spec.data.paths["/identity"].get.description,
    "returns { identity }",
  );
});

void test("normalizes the embedded Plex PMS OpenAPI spec", () => {
  const spec = extractPmsOpenApiSpec(fixtureHtml);

  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.version, "1.2.2");
  assert.deepEqual(Object.keys(spec.paths), ["/identity"]);
  assert.match(stableJson(spec), /"title": "Plex Media Server"/);
});

void test("requires the Plex PMS upstream version", () => {
  assert.throws(
    () =>
      extractPmsOpenApiSpec(
        `<script>const __redoc_state = {"spec":{"data":{"openapi":"3.1.0","info":{"title":"Plex Media Server"},"paths":{}}}};</script>`,
      ),
    /Plex PMS OpenAPI spec must include info\.version\./,
  );
});

void test("detects stale Plex PMS manifest fields", () => {
  const spec = extractPmsOpenApiSpec(fixtureHtml);
  const diffs = manifestDiffsForSpec(
    spec,
    {
      sourceUrl: "https://developer.plex.tv/pms/",
      upstreamVersion: "9.9.9",
      openapiVersion: "3.1.0",
      pathCount: 1,
      specSha256: "stale",
      generatedBy: {
        package: "@hey-api/openapi-ts",
        version: "0.97.3",
      },
      fetchedAt: "2026-05-31T00:00:00.000Z",
    },
    "0.97.3",
  );

  assert.deepEqual(diffs, [
    "Manifest field upstreamVersion is out of date.",
    "Manifest field specSha256 is out of date.",
  ]);
});
