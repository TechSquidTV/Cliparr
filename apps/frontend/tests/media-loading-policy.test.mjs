import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCapabilityCoverage,
  assertLoadedFeatures,
  classifyModules,
  discoverCodecPackages,
} from "#tests/media-loading-policy.mjs";

const packages = ["@mediabunny/ac3", "@mediabunny/future-codec"];
void test("discovers future extensions and classifies shared chunks and subpaths", () => {
  assert.deepEqual(
    discoverCodecPackages({
      mediabunny: "1",
      "@mediabunny/ac3": "1",
      "@mediabunny/future-codec": "1",
    }),
    packages,
  );
  assert.deepEqual(
    classifyModules(
      [
        "/node_modules/.pnpm/example/node_modules/@mediabunny/ac3/dist/index.js",
        String.raw`C:\node_modules\@mediabunny\future-codec\decoder.js`,
        "/src/lib/exportAudio.ts",
      ],
      packages,
    ),
    [...packages, "audioPlan"],
  );
  assert.throws(
    () =>
      classifyModules(
        ["/node_modules/@mediabunny/unclassified/index.js"],
        packages,
      ),
    /Unclassified codec/,
  );
});
void test("coverage requires emitted code and a positive scenario for every extension", () => {
  const features = [...packages, "gif", "audioPlan", "export"];
  const chunks = { "shared.js": { features, modules: [] } };
  assertCapabilityCoverage(chunks, packages, features);
  assert.throws(
    () =>
      assertCapabilityCoverage(
        chunks,
        packages,
        features.filter((feature) => feature !== packages[1]),
      ),
    /Missing positive loading scenario/,
  );
  assert.throws(
    () => assertCapabilityCoverage({}, packages, features),
    /Missing .* in build report/,
  );
});
void test("loading assertions reject early capabilities and unmapped requests", () => {
  const chunks = {
    "shared.js": {
      features: [packages[0], "audioPlan"],
      modules: ["/src/lib/exportAudio.ts"],
    },
  };
  assert.deepEqual(
    assertLoadedFeatures(
      ["shared.js"],
      chunks,
      [packages[0], "audioPlan"],
      "setup",
    ),
    [packages[0], "audioPlan"].toSorted(),
  );
  assert.throws(
    () => assertLoadedFeatures(["shared.js"], chunks, [], "preview"),
    /preview: unexpected feature downloads/,
  );
  assert.throws(
    () => assertLoadedFeatures(["unmapped.js"], chunks, [], "preview"),
    /unmapped JavaScript request/,
  );
});
