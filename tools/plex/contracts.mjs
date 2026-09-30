import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { isDeepStrictEqual } from "node:util";

export const CONTRACT_INPUTS = [
  "pms.json",
  "pms-supplement.json",
  "cloud.json",
];

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonical(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

export function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

const documentationKeys = new Set([
  "description",
  "summary",
  "example",
  "examples",
  "externalDocs",
]);
// These objects contain user-defined names, not OpenAPI keywords. A property
// named "description" must still participate in compatibility checks.
const namedMaps = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "schemas",
  "paths",
  "responses",
  "content",
  "headers",
  "parameters",
  "requestBodies",
  "callbacks",
  "links",
  "securitySchemes",
  "encoding",
  "mapping",
]);
const literalKeys = new Set(["default", "const", "enum", "security"]);

function mapContract(
  value,
  annotations,
  reference = null,
  named = false,
  baseline = null,
) {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      mapContract(
        entry,
        annotations,
        reference?.[index],
        false,
        baseline?.[index],
      ),
    );
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const result = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      !named && (literalKeys.has(key) || key.startsWith("x-"))
        ? structuredClone(entry)
        : mapContract(
            entry,
            annotations,
            reference?.[key],
            !named && namedMaps.has(key),
            baseline?.[key],
          ),
    ]),
  );
  return named ? result : annotations(result, reference, baseline);
}

function contractShape(value) {
  return mapContract(value, (entry) =>
    Object.fromEntries(
      Object.entries(entry).filter(([key]) => !documentationKeys.has(key)),
    ),
  );
}

export function contractFingerprint(value) {
  return fingerprint(contractShape(value));
}

function preserveDocumentation(corrected, upstream, expected) {
  return mapContract(
    corrected,
    (entry, original, previous) => {
      if (!original || typeof original !== "object") {
        return entry;
      }
      const result = { ...entry };
      for (const key of documentationKeys) {
        if (isDeepStrictEqual(original[key], previous?.[key])) {
          continue;
        }
        delete result[key];
        if (Object.hasOwn(original, key)) {
          result[key] = structuredClone(original[key]);
        }
      }
      return result;
    },
    upstream,
    false,
    expected,
  );
}

export function applySupplement(upstream, supplement) {
  const spec = structuredClone(upstream);
  for (const change of supplement.operations) {
    assert.ok(change.source && change.rationale);
    assert.equal(
      contractFingerprint(upstream.paths[change.from]),
      change.sourceSha256,
      `Review stale supplement for ${change.from}`,
    );
    assert.equal(
      upstream.paths[change.to],
      undefined,
      `Upstream overlaps ${change.to}`,
    );
  }
  for (const change of supplement.patches) {
    assert.ok(change.source && change.rationale);
    let target = spec;
    for (const key of change.path.slice(0, -1)) {
      target = target[key];
    }
    const key = change.path.at(-1);
    const current = contractShape(target[key] ?? null);
    // Plex may have adopted this correction. Keep its definition and docs.
    if (isDeepStrictEqual(current, contractShape(change.value))) {
      continue;
    }
    assert.deepEqual(
      current,
      contractShape(change.expected),
      `Review stale supplement: ${change.path.join("/")}`,
    );
    target[key] = preserveDocumentation(
      change.value,
      target[key],
      change.expected,
    );
  }
  for (const change of supplement.operations) {
    const item = structuredClone(spec.paths[change.from]);
    for (const operation of Object.values(item)) {
      if (change.operationId) {
        operation.operationId = change.operationId;
      }
      if (change.removePathParameters) {
        operation.parameters = operation.parameters.filter((parameter) => {
          const resolved = parameter.$ref
            ? spec.components.parameters[parameter.$ref.split("/").at(-1)]
            : parameter;
          return resolved.in !== "path";
        });
      }
      operation.parameters = [
        ...(operation.parameters ?? []),
        ...(change.parameters ?? []),
      ];
    }
    spec.paths[change.to] = item;
    if (change.kind === "move") {
      delete spec.paths[change.from];
    }
  }
  for (const change of supplement.parameters) {
    const operation = Object.values(spec.paths)
      .flatMap((item) => Object.values(item))
      .find((entry) => entry.operationId === change.operationId);
    assert.ok(operation, `Missing operation ${change.operationId}`);
    for (const parameter of change.parameters) {
      const existing = operation.parameters.find((entry) => {
        const resolved = entry.$ref
          ? spec.components.parameters[entry.$ref.split("/").at(-1)]
          : entry;
        return resolved.in === parameter.in && resolved.name === parameter.name;
      });
      if (existing) {
        const resolved = existing.$ref
          ? spec.components.parameters[existing.$ref.split("/").at(-1)]
          : existing;
        assert.deepEqual(
          contractShape(resolved),
          contractShape(parameter),
          `Upstream conflicts with parameter ${parameter.name}`,
        );
      } else {
        operation.parameters.push(structuredClone(parameter));
      }
    }
  }
  return spec;
}

export async function inputFingerprints(directory) {
  return Object.fromEntries(
    await Promise.all(
      CONTRACT_INPUTS.map(async (file) => [
        file,
        fingerprint(
          JSON.parse(await readFile(path.join(directory, file), "utf8")),
        ),
      ]),
    ),
  );
}

// Read the generated operation's own options and serializer configuration. No
// second endpoint table or runtime operation registry is maintained here.
export async function generateUrlBuilders(directory) {
  const wanted = new Set([
    "transcodeStart",
    "imageTranscode",
    "libraryMetadataGetSlash",
    "libraryGetStreamsStream",
    "startSelectedSubtitle",
  ]);
  const source = ts.createSourceFile(
    "sdk.gen.ts",
    await readFile(path.join(directory, "sdk.gen.ts"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declarations = [];
  const types = [];
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      wanted.has(node.name.text)
    ) {
      const function_ = node.initializer;
      assert.ok(
        function_ &&
          ts.isArrowFunction(function_) &&
          ts.isCallExpression(function_.body),
      );
      const dataType =
        function_.parameters[0].type.typeArguments[0].getText(source);
      const config = function_.body.arguments[0];
      assert.ok(ts.isObjectLiteralExpression(config));
      const properties = config.properties.filter(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ["url", "querySerializer", "pathSerializer"].includes(
            property.name.getText(source),
          ),
      );
      assert.ok(
        properties.some((property) => property.name.getText(source) === "url"),
      );
      types.push(dataType);
      declarations.push(
        `export function ${node.name.text}Url(options: Pick<${dataType}, "path" | "query">): string {\n  return buildUrl({ ...options, ${properties.map((property) => property.getText(source)).join(", ")} });\n}`,
      );
      wanted.delete(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(
    wanted.size,
    0,
    `Missing generated builders: ${[...wanted].join(", ")}`,
  );
  await writeFile(
    path.join(directory, "urls.gen.ts"),
    `// Generated by tools/plex/contracts.mjs. Do not edit.\nimport { buildUrl } from './client/utils.gen.ts';\nimport type { ${types.join(", ")} } from './types.gen.ts';\n${declarations.join("\n\n")}\n`,
  );
}
