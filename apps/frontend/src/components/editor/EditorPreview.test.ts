import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorPreview } from "#/components/editor/EditorPreview";
import { EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME } from "#/lib/viewTransitions";

for (const loadingPreviewFrame of [false, true]) {
  void test(`renders the editor thumbnail while loading ${loadingPreviewFrame ? "the preview frame" : "video"}`, () => {
    const markup = renderToStaticMarkup(
      createElement(EditorPreview, {
        canvasRef: () => {},
        playing: false,
        loadingPreview: !loadingPreviewFrame,
        loadingPreviewFrame,
        posterImageUrl: "/api/media/thumb.jpg",
        togglePlay: () => {},
      }),
    );

    assert.match(markup, /\/api\/media\/thumb\.jpg/);
    assert.match(markup, /blur-sm/);
    assert.match(markup, /transition-opacity/);
    assert.match(markup, /opacity-75/);
    assert.ok(
      markup.includes(
        loadingPreviewFrame ? "Loading preview frame…" : "Loading video…",
      ),
    );
    assert.match(markup, /role="status"/);
    assert.match(markup, /aria-busy="true"/);
  });
}

void test("keeps the editor thumbnail mounted after preview load for fade out", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorPreview, {
      canvasRef: () => {},
      playing: false,
      loadingPreview: false,
      loadingPreviewFrame: false,
      posterImageUrl: "/api/media/thumb.jpg",
      togglePlay: () => {},
    }),
  );

  assert.match(markup, /\/api\/media\/thumb\.jpg/);
  assert.match(markup, /transition-opacity/);
  assert.match(markup, /opacity-0/);
});

void test("renders editor poster with the shared thumbnail view transition", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorPreview, {
      canvasRef: () => {},
      playing: false,
      loadingPreview: true,
      loadingPreviewFrame: false,
      posterImageUrl: "/api/media/thumb.jpg",
      posterViewTransitionName: EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME,
      togglePlay: () => {},
    }),
  );

  assert.match(
    markup,
    new RegExp(`view-transition-name:${EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME}`),
  );
});
