import assert from "node:assert/strict";
import test from "node:test";

import { cn } from "#/lib/cn";

void test("semantic text sizes override font sizes without removing text colors", () => {
  for (const size of [
    "ui-micro",
    "ui-label",
    "editor-property",
    "editor-input",
    "editor-preview-fallback",
  ]) {
    assert.equal(
      cn("text-xs text-muted-foreground", `text-${size}`),
      `text-muted-foreground text-${size}`,
    );
    assert.equal(
      cn(`text-${size} text-foreground`, "text-sm"),
      "text-foreground text-sm",
    );
  }
});

void test("semantic text sizes preserve responsive size overrides and colors", () => {
  assert.equal(
    cn("text-xs lg:text-sm text-foreground", "text-editor-property lg:text-xs"),
    "text-foreground text-editor-property lg:text-xs",
  );
});
