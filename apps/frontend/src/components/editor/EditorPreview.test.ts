import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorPreview } from "#/components/editor/EditorPreview";
import { EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME } from "#/lib/viewTransitions";

void test("renders the editor thumbnail behind loading preview state", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorPreview, {
      canvasRef: () => {},
      playing: false,
      loadingPreview: true,
      loadingPreviewFrame: false,
      posterImageUrl: "/api/media/thumb.jpg",
      previewStatus: "Loading HLS stream...",
      previewFrameStatus: "",
      togglePlay: () => {},
    }),
  );

  assert.match(markup, /\/api\/media\/thumb\.jpg/);
  assert.match(markup, /blur-sm/);
  assert.match(markup, /transition-opacity/);
  assert.match(markup, /opacity-75/);
  assert.match(markup, /Loading HLS stream/);
});

void test("keeps the editor thumbnail mounted after preview load for fade out", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorPreview, {
      canvasRef: () => {},
      playing: false,
      loadingPreview: false,
      loadingPreviewFrame: false,
      posterImageUrl: "/api/media/thumb.jpg",
      previewStatus: "Loading HLS stream...",
      previewFrameStatus: "",
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
      previewStatus: "Loading HLS stream...",
      previewFrameStatus: "",
      togglePlay: () => {},
    }),
  );

  assert.match(
    markup,
    new RegExp(`view-transition-name:${EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME}`),
  );
});
