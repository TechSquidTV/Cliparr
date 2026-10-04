/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  Input,
  Output,
  WavOutputFormat,
  WAVE,
} from "mediabunny";
import { buildMetadataTags } from "@/lib/exportMetadata";
import type { MediaExportMetadata } from "#/providers/types";

void test("WAV ID3 muxing preserves Unicode, cover art, and JSON-only external IDs", async () => {
  const title = "Amélie – 東京 🎬";
  const tags = await buildMetadataTags(
    {
      providerId: "plex",
      itemType: "movie",
      title,
      externalIds: { imdb: "tt0211915", tmdb: "194" },
      criticRating: 8.5,
      audienceRating: 7.6,
      guids: ["private://lookup"],
      ratingKey: "private-key",
    },
    65.125,
    130.75,
    undefined,
    "wav",
  );
  assert.ok(tags);
  const cover = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const target = new BufferTarget();
  const output = new Output({
    format: new WavOutputFormat({ metadataFormat: "id3" }),
    target,
  });
  const audio = new EncodedAudioPacketSource("pcm-s16");
  output.addAudioTrack(audio);
  output.setMetadataTags({
    ...tags,
    images: [{ data: cover, mimeType: "image/png", kind: "coverFront" }],
  });
  await output.start();
  await audio.add(new EncodedPacket(new Uint8Array(160), "key", 0, 0.01), {
    decoderConfig: { codec: "pcm-s16", numberOfChannels: 1, sampleRate: 8000 },
  });
  await output.finalize();
  assert.ok(target.buffer);
  const input = new Input({
    source: new BufferSource(target.buffer),
    formats: [WAVE],
  });
  try {
    const embedded = await input.getMetadataTags();
    assert.equal(embedded.title, title);
    assert.deepEqual(embedded.images?.[0]?.data, cover);
    const descriptions = embedded.raw?.TXXX as
      Record<string, string> | undefined;
    assert.ok(descriptions);
    assert.equal(descriptions.CLIPARR_SOURCE_START_SECONDS, "65.125");
    assert.equal(descriptions.CLIPARR_SOURCE_END_SECONDS, "130.750");
    assert.equal(descriptions.CLIPARR_CLIP_DURATION_SECONDS, "65.625");
    assert.equal(descriptions.CLIPARR_SOURCE_START_TIMECODE, "00:01:05.125");
    assert.equal(descriptions.IMDB, undefined);
    assert.equal(descriptions.TMDB, undefined);
    assert.equal(descriptions.TVDB, undefined);
    const json = descriptions.CLIPARR_METADATA;
    assert.ok(typeof json === "string");
    const payload = JSON.parse(json) as {
      version: number;
      source: Partial<MediaExportMetadata>;
    };
    assert.equal(payload.version, 1);
    assert.equal(payload.source.title, title);
    assert.deepEqual(payload.source.externalIds, {
      imdb: "tt0211915",
      tmdb: "194",
    });
    assert.equal(payload.source.criticRating, 8.5);
    assert.equal(payload.source.audienceRating, 7.6);
    assert.doesNotMatch(json, /private|providerId|ratingKey|guids/);
  } finally {
    input.dispose();
  }
});
