import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { applySupplement, contractFingerprint } from "#plex/contracts.mjs";
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
  "removing a consumed generated parameter fails the actual preview consumer type check",
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
      ).sourceSha256 = contractFingerprint(changed.paths[route]);
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
        [path.resolve("apps/server/src/providers/plex/selection.ts")],
        parsed.options,
        host,
      );
      const diagnostics = ts.getPreEmitDiagnostics(program);
      assert.ok(
        diagnostics.some(
          (diagnostic) =>
            diagnostic.file?.fileName.endsWith("plex/selection.ts") &&
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

void test("documentation changes preserve new prose without weakening contract checks", () => {
  const changed = structuredClone(upstream);
  changed.components.schemas.stream.properties.codec.description =
    "Updated codec documentation";
  const route = supplement.operations[0].from;
  changed.paths[route].get.description = "Updated transcode documentation";
  changed.paths[route].get.parameters[0].description =
    "Updated parameter documentation";
  const result = applySupplement(changed, supplement);
  assert.equal(
    result.components.schemas.stream.properties.codec.type,
    "string",
  );
  assert.equal(
    result.components.schemas.stream.properties.codec.description,
    "Updated codec documentation",
  );
  assert.equal(
    result.paths[supplement.operations[0].to].get.description,
    "Updated transcode documentation",
  );
  assert.equal(
    result.paths[supplement.operations[0].to].get.parameters[0].description,
    "Updated parameter documentation",
  );
  changed.components.schemas.stream.properties.codec.type = "integer";
  assert.throws(() => applySupplement(changed, supplement), /stale supplement/);
});

void test("semantic hashes retain named schema properties and literal values", () => {
  for (const key of ["description", "summary", "example", "examples"]) {
    const before = {
      type: "object",
      properties: { [key]: { type: "string" } },
    };
    const after = { type: "object", properties: { [key]: { type: "number" } } };
    assert.notEqual(contractFingerprint(before), contractFingerprint(after));
    assert.notEqual(
      contractFingerprint({ default: { [key]: "old" } }),
      contractFingerprint({ default: { [key]: "new" } }),
    );
    assert.equal(
      contractFingerprint({ description: "old", ...before }),
      contractFingerprint({ description: "new", ...before }),
    );
  }
  assert.notEqual(
    contractFingerprint({ required: ["description"] }),
    contractFingerprint({ required: [] }),
  );
  assert.notEqual(
    contractFingerprint({ title: "OriginalModel" }),
    contractFingerprint({ title: "RenamedModel" }),
  );
});

void test("already adopted field and parameter corrections remain single definitions", () => {
  const changed = structuredClone(upstream);
  const patch = supplement.patches.find(
    (entry) =>
      entry.path.join("/") === "components/schemas/stream/properties/codec",
  );
  changed.components.schemas.stream.properties.codec = {
    ...patch.value,
    description: "Plex now declares its type",
  };
  const operation = Object.values(changed.paths)
    .flatMap((item) => Object.values(item))
    .find((item) => item.operationId === "transcodeDecision");
  operation.parameters.push({
    ...supplement.parameters[0].parameters[0],
    description: "Now official",
  });
  const result = applySupplement(changed, supplement);
  assert.equal(
    result.components.schemas.stream.properties.codec.description,
    "Plex now declares its type",
  );
  const resultOperation = Object.values(result.paths)
    .flatMap((item) => Object.values(item))
    .find((item) => item.operationId === "transcodeDecision");
  assert.equal(
    resultOperation.parameters.filter(
      (parameter) => parameter.name === "session",
    ).length,
    1,
  );
  operation.parameters.at(-1).schema = { type: "integer" };
  assert.throws(
    () => applySupplement(changed, supplement),
    /conflicts with parameter session/,
  );
});

void test("generation failures preserve the existing SDK, including late builder failures", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "plex-preserve-"));
  try {
    const inputs = path.join(temporary, "openapi");
    await cp(directory, inputs, { recursive: true });
    const generated = path.join(temporary, "generated");
    await cp("packages/plex/src/generated", generated, { recursive: true });
    for (const failure of ["supplement", "builder"]) {
      const changed = structuredClone(upstream);
      if (failure === "supplement") {
        changed.components.schemas.stream.properties.codec.type = "integer";
      } else {
        const operation = Object.values(changed.paths)
          .flatMap((item) => Object.values(item))
          .find((item) => item.operationId === "libraryGetStreamsStream");
        operation.operationId = "renamedStreamOperation";
      }
      await writeFile(path.join(inputs, "pms.json"), JSON.stringify(changed));
      await assert.rejects(
        generatePlexPmsSdk({
          inputPath: path.join(inputs, "pms.json"),
          outputDirectory: generated,
        }),
        failure === "supplement"
          ? /stale supplement/
          : /Missing generated builders/,
      );
      assert.deepEqual(
        await diffGeneratedSdk("packages/plex/src/generated", generated),
        [],
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
