import { estimateExportOutputSize } from "#/lib/exportTypes";
import assert from "node:assert/strict";
import test from "node:test";
import { AudioSample } from "mediabunny";
import {
  resolveExportAudioPlan,
  audioBitDepthSummary,
  resolveSourceAudioLayout,
  sourceAudioPrecision,
  processExportAudio,
  assertWavSize,
  type AudioSourceInfo,
} from "#/lib/exportAudio";

const source: AudioSourceInfo = {
  codec: "pcm-s16",
  numberOfChannels: 2,
  sampleRate: 48_000,
  layout: ["L", "R"],
  precision: { bits: 16, kind: "integer" },
};
const resolve = (
  info: AudioSourceInfo,
  format: Parameters<typeof resolveExportAudioPlan>[1],
  mixdown = true,
) =>
  resolveExportAudioPlan(
    info,
    format,
    mixdown,
    async () => true,
    async () => {},
  );

void test("resolves source precision from codec headers rather than decoder sample formats", () => {
  assert.deepEqual(sourceAudioPrecision("pcm-s16", new Uint8Array()), {
    bits: 16,
    kind: "integer",
  });
  assert.deepEqual(sourceAudioPrecision("pcm-f32", new Uint8Array()), {
    bits: 32,
    kind: "float",
  });
  assert.equal(sourceAudioPrecision("aac", new Uint8Array()), null);
  const header = new Uint8Array(42);
  header.set(new TextEncoder().encode("fLaC"));
  header[20] = 1;
  header[21] = 0x70;
  assert.deepEqual(sourceAudioPrecision("flac", header), {
    bits: 24,
    kind: "integer",
  });
});

void test("chooses 16/24-bit lossless settings and preserves known 32-bit WAV", async () => {
  const plan1 = await resolve(source, "flac");
  assert.equal(plan1.bits, 16);
  assert.deepEqual(audioBitDepthSummary(plan1), {
    bits: 16,
    reason: "Matches source.",
  });
  const plan2 = await resolve(
    { ...source, codec: "aac", precision: null },
    "flac",
  );
  assert.equal(plan2.bits, 24);
  assert.equal(
    audioBitDepthSummary(plan2)?.reason,
    "Source bit depth unknown.",
  );
  for (const kind of ["integer", "float"] as const) {
    const precise = { ...source, precision: { bits: 32, kind } };
    const plan3 = await resolve(precise, "wav");
    assert.equal(plan3.bits, 32);
    assert.equal(audioBitDepthSummary(plan3)?.bits, 32);
    assert.equal(audioBitDepthSummary(plan3)?.reason, "Matches source.");
    await assert.rejects(resolve(precise, "flac"), /exceeds 24-bit/);
  }
  const surround = {
    ...source,
    numberOfChannels: 6,
    layout: resolveSourceAudioLayout("flac", 6, new Uint8Array()),
  };
  const plan4 = await resolve(surround, "flac");
  assert.equal(plan4.bits, 24);
  assert.equal(
    audioBitDepthSummary(plan4)?.reason,
    "Preserves mixing precision.",
  );
  await assert.rejects(resolve(surround, "mp3", false), /Enable Mix down/);
  await assert.rejects(resolve(surround, "wav", false), /Enable Mix down/);
  await assert.rejects(
    resolve({ ...surround, layout: null }, "mp3"),
    /layout is unknown/,
  );
});

void test("lossy rate and bitrate policy preserves mono and uses legal MP3 rates", async () => {
  const mono = { ...source, numberOfChannels: 1, layout: ["C"] as const };
  const plan5 = await resolve(mono, "mp3");
  assert.equal(audioBitDepthSummary(plan5), null);
  assert.equal(plan5.bitrate, 128_000);
  const plan6 = await resolve(source, "mp3");
  assert.equal(plan6.bitrate, 256_000);
  const plan7 = await resolve({ ...source, sampleRate: 22_050 }, "mp3");
  assert.equal(plan7.bitrate, 160_000);
  const plan8 = await resolve({ ...source, sampleRate: 96_000 }, "mp3");
  assert.equal(plan8.sampleRate, 48_000);
  const plan9 = await resolve(source, "m4a");
  assert.equal(plan9.bitrate, 192_000);
  const plan10 = await resolve(source, "ogg");
  assert.equal(plan10.bitrate, 128_000);
  const plan11 = await resolve(mono, "mp4");
  assert.equal(plan11.numberOfChannels, 1);
  const plan12 = await resolve(mono, "mp4");
  assert.equal(plan12.bitrate, 160_000);
  const plan13 = await resolve({ ...source, sampleRate: 96_000 }, "flac");
  assert.equal(plan13.sampleRate, 96_000);
});

void test("identified surround contributes to the stereo mix with bounded headroom and no LFE", async () => {
  for (const channels of [3, 4, 5, 6, 7, 8]) {
    const layout = resolveSourceAudioLayout("flac", channels, new Uint8Array());
    assert.ok(layout);
    const plan = await resolve(
      { ...source, numberOfChannels: channels, layout },
      "wav",
    );
    for (let channel = 0; channel < channels; channel++) {
      const data = new Float32Array(channels);
      data[channel] = 1;
      const input = new AudioSample({
        data,
        format: "f32",
        numberOfChannels: channels,
        sampleRate: 48_000,
        timestamp: 65.125,
      });
      const mixed = processExportAudio(input, plan);
      const output = new Float32Array(2);
      mixed.copyTo(output, { format: "f32", planeIndex: 0 });
      assert.equal(mixed.timestamp, 65.125);
      assert.equal(
        output.some((value) => value > 0),
        layout[channel] !== "LFE",
      );
      if (layout[channel] === "C") {
        assert.equal(output[0], output[1]);
      }
      input.close();
      mixed.close();
    }
    const input = new AudioSample({
      data: new Float32Array(channels).fill(1),
      format: "f32",
      numberOfChannels: channels,
      sampleRate: 48_000,
      timestamp: 0,
    });
    const mixed = processExportAudio(input, plan);
    const output = new Float32Array(2);
    mixed.copyTo(output, { format: "f32", planeIndex: 0 });
    assert.ok(output.every((value) => value <= 1 && value > 0.99));
    input.close();
    mixed.close();
  }
});

void test("channel layouts use codec configuration and reject unsupported mappings", () => {
  assert.equal(resolveSourceAudioLayout("pcm-s16", 6, new Uint8Array()), null);
  assert.equal(resolveSourceAudioLayout("aac", 6, new Uint8Array()), null);
  assert.deepEqual(
    resolveSourceAudioLayout("aac", 6, new Uint8Array([0x11, 176])),
    ["C", "L", "R", "BL", "BR", "LFE"],
  );
  const opus = new Uint8Array(29);
  opus[18] = 255;
  assert.equal(resolveSourceAudioLayout("opus", 8, opus), null);
  opus[18] = 1;
  assert.deepEqual(resolveSourceAudioLayout("opus", 8, opus), [
    "L",
    "C",
    "R",
    "SL",
    "SR",
    "BL",
    "BR",
    "LFE",
  ]);
  assert.equal(resolveSourceAudioLayout("flac", 9, new Uint8Array()), null);
});

void test("audio size estimates use the resolved plan and guard RIFF limits", async () => {
  const wav = await resolve(source, "wav");
  const options = {
    format: "wav" as const,
    durationSeconds: 60,
    outputDimensions: null,
    mode: "audio-only" as const,
    resolution: "original" as const,
    audioPlan: wav,
  };
  assert.equal(estimateExportOutputSize(options).bytes, 11_520_000);
  assert.equal(
    estimateExportOutputSize({
      ...options,
      format: "flac",
      audioPlan: await resolve(source, "flac"),
    }).basis,
    "variable",
  );
  assert.equal(
    estimateExportOutputSize({ ...options, audioPlan: null }).basis,
    "unavailable",
  );
  assert.equal(
    estimateExportOutputSize({ ...options, format: "mp3" }).basis,
    "unavailable",
  );
  assert.throws(() => assertWavSize(wav, 30_000), /4 GiB/);
});

void test("unchanged channel layouts reuse the input sample and still reject channel-count changes", async () => {
  const plan = await resolve(
    {
      ...source,
      codec: "pcm-s32",
      precision: { kind: "integer", bits: 32 },
    },
    "wav",
  );
  const sample = new AudioSample({
    data: new Int32Array([2 ** 30 + 1, -(2 ** 30) - 1]),
    format: "s32",
    sampleRate: 48_000,
    numberOfChannels: 2,
    timestamp: 0,
  });
  try {
    assert.equal(processExportAudio(sample, plan), sample);
    assert.throws(
      () =>
        processExportAudio(sample, {
          ...plan,
          source: { ...plan.source, layout: ["C"], numberOfChannels: 1 },
        }),
      /channel layout changed/,
    );
  } finally {
    sample.close();
  }
});

void test("AAC configuration 12 supports 7.1 stereo mixdown without guessing unknown layouts", async () => {
  const config = new Uint8Array([0x11, 224]);
  const layout = resolveSourceAudioLayout("aac", 8, config);
  assert.deepEqual(layout, ["C", "L", "R", "SL", "SR", "BL", "BR", "LFE"]);
  const plan = await resolve(
    { ...source, codec: "aac", numberOfChannels: 8, layout },
    "mp3",
  );
  assert.equal(plan.numberOfChannels, 2);
  assert.equal(plan.mixdown, true);
  assert.equal(resolveSourceAudioLayout("aac", 6, config), null);
  assert.equal(
    resolveSourceAudioLayout("aac", 8, new Uint8Array([0x11, 0x80])),
    null,
  );
});

void test("preservation requires verified encoder speaker ordering", async () => {
  const surround = {
    ...source,
    numberOfChannels: 6,
    layout: resolveSourceAudioLayout("flac", 6, new Uint8Array()),
  };
  await assert.rejects(resolve(surround, "ogg", false), /No encoder supports/);
  const quad = {
    ...source,
    numberOfChannels: 4,
    layout: resolveSourceAudioLayout("flac", 4, new Uint8Array()),
  };
  await assert.rejects(resolve(quad, "m4a", false), /No encoder supports/);
  const aac4 = { ...quad, layout: ["L", "R", "C", "BC"] as const };
  const aacPlan = await resolve(aac4, "m4a", false);
  const flacPlan = await resolve(quad, "flac", false);
  assert.deepEqual(aacPlan.outputLayout, aac4.layout);
  assert.deepEqual(flacPlan.outputLayout, quad.layout);
});

void test("low-rate MP3 plans match the extension's output bitrate and preserve mono", async () => {
  for (const sampleRate of [8000, 11_025, 12_000]) {
    for (const numberOfChannels of [1, 2]) {
      const layout =
        numberOfChannels === 1 ? (["C"] as const) : (["L", "R"] as const);
      const plan = await resolve(
        { ...source, sampleRate, numberOfChannels, layout },
        "mp3",
      );
      assert.equal(plan.sampleRate, sampleRate);
      assert.equal(plan.numberOfChannels, numberOfChannels);
      assert.equal(plan.bitrate, 64_000);
    }
  }
});

void test("AAC preservation never reclassifies center dialogue as LFE", async () => {
  const three = {
    ...source,
    numberOfChannels: 3,
    layout: ["L", "R", "C"] as const,
  };
  await assert.rejects(resolve(three, "m4a", false), /No encoder supports/);
  const plan = await resolve(three, "m4a");
  const sample = new AudioSample({
    data: new Float32Array([0, 0, 1]),
    format: "f32",
    sampleRate: 48_000,
    numberOfChannels: 3,
    timestamp: 0,
  });
  const mixed = processExportAudio(sample, plan);
  try {
    const output = new Float32Array(2);
    mixed.copyTo(output, { format: "f32", planeIndex: 0 });
    assert.ok(output[0] > 0);
    assert.equal(output[0], output[1]);
  } finally {
    mixed.close();
    sample.close();
  }
  for (const channels of [7, 8]) {
    const layout = resolveSourceAudioLayout("flac", channels, new Uint8Array());
    await assert.rejects(
      resolve({ ...source, numberOfChannels: channels, layout }, "m4a", false),
      /No encoder supports/,
    );
  }
});
