/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { resolveFrontendConsoleLogFormat } from "@/logging";

void test("uses JSON console logs in development", () => {
  assert.equal(resolveFrontendConsoleLogFormat({ PROD: false }), "json");
});

void test("keeps pretty console logs in production", () => {
  assert.equal(resolveFrontendConsoleLogFormat({ PROD: true }), "pretty");
});
