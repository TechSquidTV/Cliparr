import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorControls } from "#/components/editor/EditorControls";
import { TooltipProvider } from "#/components/ui/tooltip";

void test("renders mobile editor controls trigger and compact range summary", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EditorControls, {
        variant: "mobile",
        playing: false,
        loadingPreview: false,
        togglePlay: () => {},
        currentTime: 12,
        duration: 120,
        startTime: 10,
        endTime: 20,
        muted: false,
        setMuted: () => {},
        volume: 1,
        setVolume: () => {},
        handleTimelineZoomIn: () => {},
        handleTimelineZoomOut: () => {},
        canZoomIn: true,
        canZoomOut: true,
        onFramegrabClick: () => {},
        framegrabDisabledReason: null,
        onPreviewTimeCommit: () => {},
        onStartTimeCommit: () => {},
        onEndTimeCommit: () => {},
        onSetInPoint: () => {},
        onSetOutPoint: () => {},
        onClearPoints: () => {},
        onFitSelection: () => {},
      }),
    ),
  );

  assert.match(markup, /More clip controls/);
  assert.match(markup, />Set in</);
  assert.match(markup, />Set out</);
  assert.doesNotMatch(markup, /aria-label="Edit Duration/);
  assert.match(markup, />In</);
  assert.match(markup, />Out</);
  assert.match(markup, />Duration</);
});

void test("renders the editor framegrab camera control", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EditorControls, {
        playing: false,
        loadingPreview: false,
        togglePlay: () => {},
        currentTime: 12,
        duration: 120,
        startTime: 10,
        endTime: 20,
        muted: false,
        setMuted: () => {},
        volume: 1,
        setVolume: () => {},
        handleTimelineZoomIn: () => {},
        handleTimelineZoomOut: () => {},
        canZoomIn: true,
        canZoomOut: true,
        onFramegrabClick: () => {},
        framegrabDisabledReason: null,
        onPreviewTimeCommit: () => {},
        onStartTimeCommit: () => {},
        onEndTimeCommit: () => {},
        onSetInPoint: () => {},
        onSetOutPoint: () => {},
        onClearPoints: () => {},
        onFitSelection: () => {},
      }),
    ),
  );

  assert.match(markup, /Export current preview frame/);
  assert.match(markup, /Set in point at the playhead/);
  assert.match(markup, /Set out point at the playhead/);
  assert.match(markup, /Clear in and out points/);
  assert.ok(
    markup.indexOf('aria-label="Zoom timeline out"') <
      markup.indexOf('aria-label="Zoom timeline in"'),
  );
  assert.ok(
    markup.indexOf('aria-label="Zoom timeline in"') <
      markup.indexOf('aria-label="Export current preview frame"'),
  );
});
