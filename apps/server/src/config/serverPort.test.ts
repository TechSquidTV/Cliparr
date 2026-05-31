import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DEVELOPMENT_PORT,
  DEFAULT_PRODUCTION_PORT,
  resolveServerPort,
} from "@/config/serverPort";

void test("defaults the production server port to 7171", () => {
  assert.equal(resolveServerPort({ NODE_ENV: "production" }), 7171);
  assert.equal(DEFAULT_PRODUCTION_PORT, 7171);
});

void test("keeps the development server port on 3000", () => {
  assert.equal(resolveServerPort({ NODE_ENV: "development" }), 3000);
  assert.equal(resolveServerPort({}), 3000);
  assert.equal(DEFAULT_DEVELOPMENT_PORT, 3000);
});

void test("lets PORT override the environment default", () => {
  assert.equal(
    resolveServerPort({ NODE_ENV: "production", PORT: "8123" }),
    8123,
  );
});
