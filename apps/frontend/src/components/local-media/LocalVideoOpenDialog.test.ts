import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LocalVideoOpenDialog } from "#/components/local-media/LocalVideoOpenDialog";

void test("renders local video dialog file picker workflow", () => {
  const markup = renderToStaticMarkup(
    createElement(LocalVideoOpenDialog, {
      isOpen: true,
      canOpenUrl: true,
      onClose: () => {},
      onOpened: () => {},
    }),
  );

  assert.match(markup, /Open Video/);
  assert.match(markup, /Local files stay in your browser/);
  assert.match(markup, /Choose File/);
});

void test("explains and disables URL opening before provider sign-in", () => {
  const markup = renderToStaticMarkup(
    createElement(LocalVideoOpenDialog, {
      isOpen: true,
      canOpenUrl: false,
      onClose: () => {},
      onOpened: () => {},
    }),
  );

  assert.match(markup, /Sign in to a provider to open a URL/);
  assert.match(markup, /<button[^>]*disabled[^>]*>[\s\S]*?URL<\/button>/);
  assert.match(markup, /Choose File/);
  assert.doesNotMatch(markup, /type="url"/);
});
