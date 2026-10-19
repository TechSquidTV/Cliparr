import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorFramegrabDialog } from "#/components/editor/EditorFramegrabDialog";

void test("renders the framegrab export dialog actions", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorFramegrabDialog, {
      isOpen: true,
      title: "Example Movie",
      frameTime: 61.2,
      dimensions: {
        width: 1920,
        height: 1080,
      },
      selectedFormat: "png",
      onFormatChange: () => {},
      selectedQuality: "high",
      onQualityChange: () => {},
      fileNamePreview: "Example Movie [01m01s].png",
      processingAction: null,
      error: null,
      message: "Copied to clipboard.",
      onClose: () => {},
      onCopy: () => {},
      onDownload: () => {},
    }),
  );

  assert.match(markup, /Export Frame/);
  assert.match(markup, /Image Type/);
  assert.match(markup, /Quality/);
  assert.match(markup, />Time</);
  assert.match(markup, /Copy Image/);
  assert.match(markup, /Download PNG/);
  assert.match(markup, /data-slot="select-value">PNG \.png<\/span>/);
  assert.doesNotMatch(markup, />Cancel</);
  assert.match(markup, /w-44/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.doesNotMatch(markup, /sr-only/);
  assert.match(markup, /Copied to clipboard\./);
  assert.match(markup, /Example Movie \[01m01s]\.png/);
});

void test("renders framegrab capture errors without a captured canvas", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorFramegrabDialog, {
      isOpen: true,
      title: "Example Movie",
      frameTime: 61.2,
      dimensions: null,
      selectedFormat: "png",
      onFormatChange: () => {},
      selectedQuality: "high",
      onQualityChange: () => {},
      fileNamePreview: "Example Movie [01m01s].png",
      processingAction: null,
      error: "No preview frame is available yet.",
      message: null,
      onClose: () => {},
      onCopy: () => {},
      onDownload: () => {},
    }),
  );

  assert.match(markup, /No preview frame is available yet\./);
  assert.match(markup, /Unavailable/);
  assert.match(markup, /disabled/);
});
