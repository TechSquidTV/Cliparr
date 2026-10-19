import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorRangeControl } from "#/components/editor/EditorPropertyControls";

void test("range controls connect distinct labels and expose values with units", () => {
  const render = (label: string) =>
    createElement(EditorRangeControl, {
      label,
      value: 24,
      min: 16,
      max: 150,
      step: 1,
      unit: "px",
      onChange: () => {},
    });
  const markup = renderToStaticMarkup(
    createElement("div", null, render("Font size"), render("Shadow offset")),
  );
  const labels = [...markup.matchAll(/aria-labelledby="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(labels.length, 2);
  assert.notEqual(labels[0], labels[1]);
  for (const id of labels) {
    assert.ok(markup.includes(`id="${id}"`));
  }
  assert.equal([...markup.matchAll(/aria-valuetext="24px"/g)].length, 2);
});
