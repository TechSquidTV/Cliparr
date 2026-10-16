import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ScrollArea } from "#/components/ui/scroll-area";

void test("renders scroll area structure for constrained dropdown content", () => {
  const markup = renderToStaticMarkup(
    createElement(
      ScrollArea,
      {
        className: "max-h-72",
        contentClassName: "pr-3",
        viewportClassName: "max-h-72",
      },
      createElement("div", null, "Scrollable content"),
    ),
  );

  assert.match(markup, /data-slot="scroll-area"/);
  assert.match(markup, /data-slot="scroll-area-viewport"/);
  assert.match(markup, /data-slot="scroll-area-content"/);
  assert.match(markup, /style="overflow:scroll"/);
  assert.match(markup, /max-h-72/);
});
