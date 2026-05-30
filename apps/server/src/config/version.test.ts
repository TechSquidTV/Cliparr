import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCliparrClientVersion,
  resolveCliparrVersion,
} from "@/config/version";

void test("uses CI build identity exactly as provided", () => {
  assert.equal(
    resolveCliparrVersion({
      CLIPARR_VERSION: "main@abc1234",
    }),
    "main@abc1234",
  );
});

void test("preserves release tags as display-ready values", () => {
  assert.equal(
    resolveCliparrVersion({
      CLIPARR_VERSION: "v1.2.3",
    }),
    "v1.2.3",
  );
});

void test("omits the display version when CI has not injected one", () => {
  assert.equal(
    resolveCliparrVersion({
      CLIPARR_VERSION: " ",
      npm_package_version: "9.9.9",
    }),
    undefined,
  );
});

void test("uses an explicit local client version when CI has not injected one", () => {
  assert.equal(
    resolveCliparrClientVersion({
      CLIPARR_VERSION: "",
      npm_package_version: "9.9.9",
    }),
    "dev",
  );
});
