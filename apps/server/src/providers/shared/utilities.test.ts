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

void test("scales Jellyfin critic scores from 0-100 and rounds after scaling", () => {
  assert.equal(normalizeRating(0, 100), 0);
  assert.equal(normalizeRating(85, 100), 8.5);
  assert.equal(normalizeRating(100, 100), 10);
  assert.equal(normalizeRating(8, 100), 0.8);
  assert.equal(normalizeRating(8.5, 100), 0.9);
  assert.equal(normalizeRating(10, 100), 1);
  assert.equal(normalizeRating(10.04, 100), 1);
  assert.equal(normalizeRating(null, 100), undefined);
  assert.equal(normalizeRating(101, 100), undefined);
  assert.equal(normalizeRating(-1, 100), undefined);
});
