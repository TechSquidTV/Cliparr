import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorTimelinePane } from "#/components/editor/EditorLayout";

void test("keeps timeline geometry mounted and inert until media is ready", () => {
  const waitingMarkup = renderToStaticMarkup(
    createElement(EditorTimelinePane, {
      variant: "desktop",
      controls: createElement("div"),
      hasDuration: false,
      timeline: createElement("button", null, "Timeline interaction"),
    }),
  );
  const readyMarkup = renderToStaticMarkup(
    createElement(EditorTimelinePane, {
      variant: "desktop",
      controls: createElement("div"),
      hasDuration: true,
      timeline: createElement("button", null, "Timeline interaction"),
    }),
  );

  assert.match(waitingMarkup, /data-editor-waiting-duration/);
  assert.match(waitingMarkup, /Loading timeline…/);
  assert.match(waitingMarkup, /inert=""/);
  assert.match(waitingMarkup, /aria-busy="true"/);
  assert.match(waitingMarkup, /Timeline interaction/);
  assert.match(readyMarkup, /data-editor-timeline-ready/);
  assert.match(readyMarkup, /Timeline interaction/);
  assert.doesNotMatch(readyMarkup, /inert=""/);
  assert.doesNotMatch(readyMarkup, /Loading timeline…/);
});
