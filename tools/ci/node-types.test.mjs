import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
const catalog = workspace.match(/^catalog:\n((?:[ \t]+[^\n]*\n|\n)*)/mu)?.[1];
const range = catalog?.match(/^\s+"@types\/node": (\S+)$/mu)?.[1];
const manifests = globSync([
  "package.json",
  "apps/*/package.json",
  "packages/*/package.json",
  "tools/*/package.json",
]);
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const consumers = manifests.filter((file) => {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  return dependencyFields.some(
    (field) => manifest[field]?.["@types/node"] !== undefined,
  );
});

void test("the shared Node typings catalog retains the supported Node 26 API surface", () => {
  assert.match(range ?? "", /^\^26\.\d+\.\d+$/u);
  assert.ok(
    consumers.length > 0,
    "workspace Node typings consumers must be discovered",
  );
});

for (const file of consumers) {
  void test(`${file} consumes the shared Node typings catalog`, () => {
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    for (const field of dependencyFields) {
      if (manifest[field]?.["@types/node"] !== undefined) {
        assert.equal(manifest[field]["@types/node"], "catalog:");
      }
    }
  });
}

void test("the lockfile resolves every catalog consumer to the same Node 26 typings", () => {
  const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
  const locked = lockfile.match(
    /^catalogs:\n {2}default:\n {4}'@types\/node':\n {6}specifier: (\S+)\n {6}version: (\S+)$/mu,
  );
  assert.ok(locked, "lockfile must record the shared catalog resolution");
  assert.equal(locked[1], range);
  assert.match(locked[2], /^26\.\d+\.\d+$/u);
  const versions = [
    ...lockfile.matchAll(
      /^ {6}'@types\/node':\n {8}specifier: 'catalog:'\n {8}version: (\S+)$/gmu,
    ),
  ].map((match) => match[1]);
  assert.equal(versions.length, consumers.length);
  assert.deepEqual([...new Set(versions)], [locked[2]]);
});
