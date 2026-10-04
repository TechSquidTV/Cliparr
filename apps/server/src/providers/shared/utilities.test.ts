import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRating } from "@/providers/shared/utilities";

void test("normalizes ratings without fabricating missing or out-of-range scores", () => {
  for (const value of [
    undefined,
    null,
    "",
    " ",
    "no rating",
    Number.NaN,
    Infinity,
    -1,
    10.01,
  ]) {
    assert.equal(normalizeRating(value), undefined);
  }
  assert.equal(normalizeRating(0), 0);
  assert.equal(normalizeRating(10), 10);
  assert.equal(normalizeRating(8.54), 8.5);
  assert.equal(normalizeRating("7.6"), 7.6);
});

void test("scales Jellyfin critic scores only above 10 and rounds after scaling", () => {
  assert.equal(normalizeRating(85, true), 8.5);
  assert.equal(normalizeRating(100, true), 10);
  assert.equal(normalizeRating(8.5, true), 8.5);
  assert.equal(normalizeRating(10, true), 10);
  assert.equal(normalizeRating(10.04, true), 1);
  assert.equal(normalizeRating(null, true), undefined);
  assert.equal(normalizeRating(101, true), undefined);
  assert.equal(normalizeRating(-1, true), undefined);
});
