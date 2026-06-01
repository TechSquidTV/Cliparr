/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseHlsExportEstimateMetadata,
  selectHlsExportEstimateMetadata,
} from "@/lib/hlsExportEstimate";

void test("parses HLS stream bitrate and dimensions from master playlists", () => {
  const variants = parseHlsExportEstimateMetadata(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000,AVERAGE-BANDWIDTH=960000,RESOLUTION=854x480,FRAME-RATE=23.976
480p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5600000,RESOLUTION=1920x1080
1080p/index.m3u8
`);

  assert.deepEqual(variants, [
    {
      bandwidth: 1_280_000,
      averageBandwidth: 960_000,
      bitrateKbps: 960,
      bitrateBasis: "average-bandwidth",
      width: 854,
      height: 480,
      frameRate: 23.976,
    },
    {
      bandwidth: 5_600_000,
      averageBandwidth: undefined,
      bitrateKbps: 5_600,
      bitrateBasis: "bandwidth",
      width: 1920,
      height: 1080,
      frameRate: undefined,
    },
  ]);
});

void test("selects the HLS estimate closest to output dimensions", () => {
  const variants = parseHlsExportEstimateMetadata(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480
480p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5400000,RESOLUTION=1920x1080
1080p/index.m3u8
`);

  assert.deepEqual(
    selectHlsExportEstimateMetadata(variants, { width: 860, height: 480 }),
    {
      bitrateKbps: 1_200,
      bitrateBasis: "bandwidth",
      width: 854,
      height: 480,
      frameRate: undefined,
      variantCount: 2,
    },
  );
  assert.deepEqual(
    selectHlsExportEstimateMetadata(variants, { width: 1920, height: 1072 }),
    {
      bitrateKbps: 5_400,
      bitrateBasis: "bandwidth",
      width: 1920,
      height: 1080,
      frameRate: undefined,
      variantCount: 2,
    },
  );
});
