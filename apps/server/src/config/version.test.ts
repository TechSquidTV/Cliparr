import assert from "node:assert/strict";
import test from "node:test";
import { resolveCliparrVersion } from "./version.js";

void test("uses CI build identity exactly as provided", () => {
  assert.equal(
    resolveCliparrVersion({
      CLIPARR_VERSION: "main@abc1234",
    }),
    "main@abc1234"
  );
});

void test("preserves release tags as display-ready values", () => {
  assert.equal(
    resolveCliparrVersion({
      CLIPARR_VERSION: "v0.4.0",
    }),
    "v0.4.0"
  );
});

void test("falls back to the package version when environment values are empty", () => {
  assert.equal(
    resolveCliparrVersion({
      CLIPARR_VERSION: " ",
      npm_package_version: "",
    }),
    "0.4.0"
  );
});
