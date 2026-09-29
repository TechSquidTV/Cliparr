import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { applySupplement, fingerprint } from "#plex/contracts.mjs";
import { generatePlexPmsSdk, diffGeneratedSdk } from "#plex/pms-openapi.mjs";

const directory = path.resolve("packages/plex/openapi");
const upstream = JSON.parse(
  await readFile(path.join(directory, "pms.json"), "utf8"),
);
const supplement = JSON.parse(
  await readFile(path.join(directory, "pms-supplement.json"), "utf8"),
);
void test("supplements reject upstream overlaps and stale field assumptions", () => {
  const overlapping = structuredClone(upstream);
  overlapping.paths["/subtitles/:/transcode/universal/start"] = {};
  assert.throws(() => applySupplement(overlapping, supplement), /overlaps/);
  const changed = structuredClone(upstream);
  changed.components.schemas.stream.properties.codec.type = "integer";
  assert.throws(() => applySupplement(changed, supplement), /stale supplement/);
  const changedRoute = structuredClone(upstream);
  changedRoute.paths["/library/sections/all"].get.operationId = "newSections";
  assert.throws(
    () => applySupplement(changedRoute, supplement),
    /stale supplement/,
  );
});

void test("generated output comparison detects missing and modified artifacts", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "plex-diff-"));
  try {
    await cp("packages/plex/src/generated", temporary, { recursive: true });
    await writeFile(path.join(temporary, "pms/urls.gen.ts"), "stale");
    await rm(path.join(temporary, "cloud/sdk.gen.ts"));
    const diffs = await diffGeneratedSdk(
      "packages/plex/src/generated",
      temporary,
    );
    assert.ok(diffs.some((entry) => entry.includes("urls.gen.ts")));
    assert.ok(diffs.some((entry) => entry.includes("cloud/sdk.gen.ts")));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test(
  "removing a consumed generated parameter fails the actual playback consumer type check",
  { timeout: 30_000 },
  async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "plex-consumer-"));
    try {
      const inputs = path.join(temporary, "openapi");
      await cp(directory, inputs, { recursive: true });
      const changed = structuredClone(upstream);
      const route = "/{transcodeType}/:/transcode/universal/start.*";
      changed.paths[route].get.parameters = changed.paths[
        route
      ].get.parameters.filter((parameter) => parameter.name !== "videoQuality");
      const reviewed = structuredClone(supplement);
      reviewed.operations.find(
        (operation) => operation.from === route,
      ).sourceSha256 = fingerprint(changed.paths[route]);
      await writeFile(path.join(inputs, "pms.json"), JSON.stringify(changed));
      await writeFile(
        path.join(inputs, "pms-supplement.json"),
        JSON.stringify(reviewed),
      );
      const generated = path.join(temporary, "generated");
      await generatePlexPmsSdk({
        inputPath: path.join(inputs, "pms.json"),
        outputDirectory: generated,
      });
      const configFile = path.resolve("apps/server/tsconfig.json");
      const config = ts.readConfigFile(configFile, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(
        config.config,
        ts.sys,
        path.dirname(configFile),
      );
      const host = ts.createCompilerHost(parsed.options);
      host.resolveModuleNames = (names, containingFile) =>
        names.map((name) => {
          let redirected = name;
          if (name === "@cliparr/plex/pms/urls") {
            redirected = path.join(generated, "pms/urls.gen.ts");
          }
          if (name === "@cliparr/plex/pms/types") {
            redirected = path.join(generated, "pms/types.gen.ts");
          }
          return ts.resolveModuleName(
            redirected,
            containingFile,
            parsed.options,
            host,
          ).resolvedModule;
        });
      const program = ts.createProgram(
        [path.resolve("apps/server/src/providers/plex/playback.ts")],
        parsed.options,
        host,
      );
      const diagnostics = ts.getPreEmitDiagnostics(program);
      assert.ok(
        diagnostics.some(
          (diagnostic) =>
            diagnostic.file?.fileName.endsWith("plex/playback.ts") &&
            ts
              .flattenDiagnosticMessageText(diagnostic.messageText, " ")
              .includes("videoQuality"),
        ),
        "A removed consumed parameter must break the real application consumer",
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
