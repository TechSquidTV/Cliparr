/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AuthCompleteScreen from "./AuthCompleteScreen";
import { EditorPreview } from "./editor/EditorPreview";
import { LocalVideoOpenDialog } from "./local-media/LocalVideoOpenDialog";

void test("renders the provider auth completion screen", () => {
  const markup = renderToStaticMarkup(createElement(AuthCompleteScreen));

  assert.match(markup, /Plex sign-in finished/);
  assert.match(markup, /Close this tab/);
});

void test("renders local video dialog file picker workflow", () => {
  const markup = renderToStaticMarkup(
    createElement(LocalVideoOpenDialog, {
      isOpen: true,
      onClose: () => undefined,
      onOpened: () => undefined,
    }),
  );

  assert.match(markup, /Open Video/);
  assert.match(markup, /Local files stay in your browser/);
  assert.match(markup, /Choose File/);
});

void test("renders the editor thumbnail behind loading preview state", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorPreview, {
      canvasRef: createRef<HTMLCanvasElement>(),
      playing: false,
      loadingPreview: true,
      loadingPreviewFrame: false,
      posterImageUrl: "/api/media/thumb.jpg",
      previewStatus: "Loading HLS stream...",
      previewFrameStatus: "",
      togglePlay: () => undefined,
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
      canvasRef: createRef<HTMLCanvasElement>(),
      playing: false,
      loadingPreview: false,
      loadingPreviewFrame: false,
      posterImageUrl: "/api/media/thumb.jpg",
      previewStatus: "Loading HLS stream...",
      previewFrameStatus: "",
      togglePlay: () => undefined,
    }),
  );

  assert.match(markup, /\/api\/media\/thumb\.jpg/);
  assert.match(markup, /transition-opacity/);
  assert.match(markup, /opacity-0/);
});
