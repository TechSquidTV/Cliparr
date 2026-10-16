import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import AuthCompleteScreen from "#/components/dashboard/AuthCompleteScreen";

void test("renders the provider auth completion screen", () => {
  const markup = renderToStaticMarkup(createElement(AuthCompleteScreen));

  assert.match(markup, /Plex sign-in finished/);
  assert.match(markup, /Close this tab/);
});
