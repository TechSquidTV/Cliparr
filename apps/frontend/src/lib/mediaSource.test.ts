/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";

import type { EditorMediaSource } from "#/components/editor/editorMedia";
import { isHlsMediaSource, isHlsPlaylistUrl } from "#/lib/mediaSource";

void test("identifies HLS playlist URLs with optional query strings or fragments", () => {
  for (const url of [
    "/master.m3u8",
    "/MASTER.M3U8?token=1",
    "/master.m3u8#track",
  ]) {
    assert.equal(isHlsPlaylistUrl(url), true, url);
  }
  for (const url of [
    "/movie.mp4",
    "/master.m3u8.mp4",
    "/movie?file=master.m3u8x",
  ]) {
    assert.equal(isHlsPlaylistUrl(url), false, url);
  }
});

void test("classifies URL sources by flag or playlist URL, but never files", () => {
  const urlSource = {
    kind: "url",
    role: "direct-url",
    label: "URL",
    url: "/movie.mp4",
  } satisfies EditorMediaSource;
  assert.equal(isHlsMediaSource(urlSource), false);
  assert.equal(isHlsMediaSource({ ...urlSource, hls: true }), true);
  assert.equal(
    isHlsMediaSource({ ...urlSource, hls: false, url: "/master.m3u8?token=1" }),
    true,
  );
  assert.equal(
    isHlsMediaSource({
      kind: "file",
      role: "local-file",
      label: "File",
      file: new File([], "master.m3u8"),
      fileName: "master.m3u8",
    }),
    false,
  );
  assert.equal(
    isHlsMediaSource({
      kind: "file-handle",
      role: "local-file",
      label: "File",
      handle: {
        name: "master.m3u8",
        getFile: async () => new File([], "master.m3u8"),
      },
      fileName: "master.m3u8",
    }),
    false,
  );
});
