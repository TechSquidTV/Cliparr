/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AuthCompleteScreen from "@/components/AuthCompleteScreen";
import { EditorControls } from "@/components/editor/EditorControls";
import { EditorFramegrabDialog } from "@/components/editor/EditorFramegrabDialog";
import { EditorPreview } from "@/components/editor/EditorPreview";
import { LocalVideoOpenDialog } from "@/components/local-media/LocalVideoOpenDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME } from "@/lib/viewTransitions";

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

void test("renders editor poster with the shared thumbnail view transition", () => {
  const markup = renderToStaticMarkup(
    createElement(EditorPreview, {
      canvasRef: createRef<HTMLCanvasElement>(),
      playing: false,
      loadingPreview: true,
      loadingPreviewFrame: false,
      posterImageUrl: "/api/media/thumb.jpg",
      posterViewTransitionName: EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME,
      previewStatus: "Loading HLS stream...",
      previewFrameStatus: "",
      togglePlay: () => undefined,
    }),
  );

  assert.match(
    markup,
    new RegExp(`view-transition-name:${EDITOR_THUMBNAIL_VIEW_TRANSITION_NAME}`),
  );
});

void test("renders the editor framegrab camera control", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EditorControls, {
        playing: false,
        loadingPreview: false,
        togglePlay: () => undefined,
        currentTime: 12,
        duration: 120,
        startTime: 10,
        endTime: 20,
        muted: false,
        setMuted: () => undefined,
        volume: 1,
        setVolume: () => undefined,
        handleTimelineZoomIn: () => undefined,
        handleTimelineZoomOut: () => undefined,
        canZoomIn: true,
        canZoomOut: true,
        onFramegrabClick: () => undefined,
        framegrabDisabledReason: null,
        onPreviewTimeCommit: () => undefined,
        onStartTimeCommit: () => undefined,
        onEndTimeCommit: () => undefined,
      }),
    ),
  );

  assert.match(markup, /Export current preview frame/);
});

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
      onFormatChange: () => undefined,
      selectedQuality: "high",
      onQualityChange: () => undefined,
      fileNamePreview: "Example Movie [01m01s].png",
      processingAction: null,
      error: null,
      message: "Copied to clipboard.",
      onClose: () => undefined,
      onCopy: () => undefined,
      onDownload: () => undefined,
    }),
  );

  assert.match(markup, /Export Frame/);
  assert.match(markup, /Image Type/);
  assert.match(markup, /Quality/);
  assert.match(markup, /Copy Image/);
  assert.match(markup, /Download PNG/);
  assert.doesNotMatch(markup, />Cancel</);
  assert.match(markup, /w-44/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.doesNotMatch(markup, /sr-only/);
  assert.match(markup, /Copied to clipboard\./);
  assert.match(markup, /Example Movie \[01m01s\]\.png/);
});
