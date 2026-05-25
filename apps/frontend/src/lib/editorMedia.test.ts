/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { titleFromUrl } from "./editorMedia";

void test("uses the URL host as the title when no path segment is present", () => {
  assert.equal(titleFromUrl("https://example.com/"), "example.com");
  assert.equal(titleFromUrl("https://example.com"), "example.com");
});

void test("uses the final URL path segment as the title when present", () => {
  assert.equal(titleFromUrl("https://example.com/media/example%20clip.mp4"), "example clip");
});
