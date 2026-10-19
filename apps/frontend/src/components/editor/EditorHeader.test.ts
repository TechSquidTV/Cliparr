import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorHeader } from "#/components/editor/EditorHeader";
import { TooltipProvider } from "#/components/ui/tooltip";

void test("reserves editor export progress label width", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EditorHeader, {
        title: "Example Movie",
        onBack: () => {},
        exporting: true,
        progress: 0.07,
        exportDisabledReason: null,
        onExportClick: () => {},
      }),
    ),
  );

  assert.match(markup, /w-40/);
  assert.match(markup, /w-\[4ch]/);
  assert.match(markup, />7%<\/span>/);
});
