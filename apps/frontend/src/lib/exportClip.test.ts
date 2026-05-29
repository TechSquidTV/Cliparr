/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { ConversionOptions } from "mediabunny";
import { exportClipWithRuntime } from "./exportClip";
import type { EditorMediaSource } from "./editorMedia";
import type { SubtitleStyleSettings } from "./subtitles/types";

type ExportRuntime = Parameters<typeof exportClipWithRuntime>[1];
type CliparrInput = Awaited<
  ReturnType<ExportRuntime["createCliparrInputFromSource"]>
>;
type ConversionResult = Awaited<ReturnType<ExportRuntime["initConversion"]>>;
type OutputFormat = ReturnType<ExportRuntime["createOutputFormat"]>;
type BufferTargetResult = ReturnType<ExportRuntime["createBufferTarget"]>;
type OutputResult = ReturnType<ExportRuntime["createOutput"]>;
type SubtitleProcessor = ReturnType<
  ExportRuntime["buildSubtitleBurnInProcessor"]
>;

const mediaSource = {
  kind: "url",
  role: "direct",
  label: "Direct",
  url: "/api/media/handle-1",
} satisfies EditorMediaSource;

const subtitleStyle = {
  fontFamily: "Arial",
  fontSize: 40,
  fontColor: "#ffffff",
  shadowColor: "#000000",
  shadowBlur: 2,
  shadowOffsetY: 2,
  strokeColor: "#000000",
  strokeWidth: 2,
  bottomMargin: 48,
  lineHeight: 1.2,
} satisfies SubtitleStyleSettings;

function createRuntime(overrides: Partial<ExportRuntime> = {}) {
  const target = { buffer: undefined as ArrayBuffer | undefined };
  const videoTrack = {
    id: "video-1",
    hasOnlyKeyPackets: async () => false,
  };
  const audioTrack = {
    id: "audio-1",
  };
  let disposed = false;

  const input = {
    async getPrimaryVideoTrack({
      filter,
    }: {
      filter: (track: typeof videoTrack) => Promise<boolean>;
    }) {
      assert.equal(await filter(videoTrack), true);
      return videoTrack;
    },
    async getAudioTracks() {
      return [audioTrack];
    },
    dispose() {
      disposed = true;
    },
  } as unknown as CliparrInput;

  const runtime = {
    ensureMediabunnyCodecs: async () => undefined,
    createCliparrInputFromSource: async () => input,
    selectPreferredPairableAudioTrack: async (_videoTrack, audioTracks) =>
      audioTracks[0] ?? null,
    getTrackTimelineOffsetSeconds: async () => 5,
    getVideoTrackDimensions: async () => ({ width: 1920, height: 1080 }),
    buildMetadataTags: async () => ({ title: "Clip" }),
    describeDiscardedTracks: async () => "",
    patchMp4MetadataBoxes: () => undefined,
    createOutputFormat: () =>
      ({ mimeType: "video/mp4" }) as unknown as OutputFormat,
    createBufferTarget: () => target as unknown as BufferTargetResult,
    createOutput: (options) => ({ options }) as unknown as OutputResult,
    initConversion: async () =>
      createConversion({
        target,
        bytes: [1, 2, 3],
        utilizedAudio: true,
        progress: 0.5,
      }),
    buildSubtitleBurnInProcessor: () =>
      (() => ({})) as unknown as SubtitleProcessor,
    ...overrides,
  } satisfies ExportRuntime;

  return {
    runtime,
    target,
    input,
    videoTrack,
    audioTrack,
    get disposed() {
      return disposed;
    },
  };
}

function createConversion({
  target,
  bytes,
  utilizedAudio,
  progress,
}: {
  target: { buffer: ArrayBuffer | undefined };
  bytes?: number[];
  utilizedAudio: boolean;
  progress?: number;
}) {
  let onProgress: ((progress: number) => void) | undefined;

  return {
    isValid: true,
    utilizedTracks: utilizedAudio ? [{ isAudioTrack: () => true }] : [],
    discardedTracks: [],
    get onProgress() {
      return onProgress;
    },
    set onProgress(next: ((progress: number) => void) | undefined) {
      onProgress = next;
    },
    async execute() {
      if (progress !== undefined) {
        onProgress?.(progress);
      }
      if (bytes) {
        target.buffer = new Uint8Array(bytes).buffer;
      }
    },
  } as unknown as ConversionResult;
}

void test("builds and executes a trimmed conversion with selected audio and metadata", async () => {
  let capturedHls: boolean | undefined;
  let capturedOptions: ConversionOptions | undefined;
  let patchedBytes: number[] = [];
  const progress: number[] = [];
  const context = createRuntime();
  context.runtime.createCliparrInputFromSource = async (_source, options) => {
    capturedHls = options?.hls;
    return context.input;
  };
  context.runtime.initConversion = async (options) => {
    capturedOptions = options;
    return createConversion({
      target: context.target,
      bytes: [1, 2, 3],
      utilizedAudio: true,
      progress: 0.5,
    });
  };
  context.runtime.patchMp4MetadataBoxes = (bytes) => {
    patchedBytes = [...bytes];
  };

  const blob = await exportClipWithRuntime(
    {
      mediaSource,
      hls: true,
      startTime: 10,
      endTime: 15,
      format: "mp4",
      resolution: "720",
      includeAudio: true,
      metadata: {
        providerId: "plex",
        itemType: "movie",
        title: "Movie",
      },
      onProgress: (value) => progress.push(value),
    },
    context.runtime,
  );

  assert.equal(capturedHls, true);
  assert.equal(capturedOptions?.trim?.start, 15);
  assert.equal(capturedOptions?.trim?.end, 20);
  assert.equal(blob.type, "video/mp4");
  assert.equal(blob.size, 3);
  assert.deepEqual(progress, [0.5]);
  assert.deepEqual(patchedBytes, [1, 2, 3]);
  assert.equal(context.disposed, true);

  const audioOptionsForTrack = capturedOptions?.audio;
  assert.equal(typeof audioOptionsForTrack, "function");
  if (typeof audioOptionsForTrack !== "function") {
    throw new Error("Expected audio conversion options to be a function");
  }
  const selectedAudioOptions = audioOptionsForTrack(
    { id: "audio-1" } as unknown as Parameters<typeof audioOptionsForTrack>[0],
    1,
  ) as { discard: boolean };
  const otherAudioOptions = audioOptionsForTrack(
    { id: "audio-2" } as unknown as Parameters<typeof audioOptionsForTrack>[0],
    2,
  ) as { discard: boolean };
  assert.equal(selectedAudioOptions.discard, false);
  assert.equal(otherAudioOptions.discard, true);

  const videoOptionsForTrack = capturedOptions?.video;
  assert.equal(typeof videoOptionsForTrack, "function");
  if (typeof videoOptionsForTrack !== "function") {
    throw new Error("Expected video conversion options to be a function");
  }
  const selectedVideoOptions = videoOptionsForTrack(
    { id: "video-1" } as unknown as Parameters<typeof videoOptionsForTrack>[0],
    1,
  ) as { discard: boolean; height?: number };
  const otherVideoOptions = videoOptionsForTrack(
    { id: "video-2" } as unknown as Parameters<typeof videoOptionsForTrack>[0],
    2,
  ) as { discard: boolean; height?: number };
  assert.equal(selectedVideoOptions.discard, false);
  assert.equal(selectedVideoOptions.height, 720);
  assert.equal(otherVideoOptions.discard, true);
});

void test("fails before execution when conversion would drop source audio", async () => {
  const context = createRuntime({
    describeDiscardedTracks: async () => "Codec unsupported.",
    initConversion: async () =>
      ({
        isValid: true,
        utilizedTracks: [],
        discardedTracks: [{}],
        execute: async () => {
          throw new Error("execute should not run");
        },
      }) as unknown as ConversionResult,
  });

  await assert.rejects(
    () =>
      exportClipWithRuntime(
        {
          mediaSource,
          startTime: 0,
          endTime: 10,
          format: "webm",
          resolution: "original",
          includeAudio: true,
          onProgress: () => undefined,
        },
        context.runtime,
      ),
    /Export would drop the source audio track\. Codec unsupported\./,
  );
  assert.equal(context.disposed, true);
});

void test("validates subtitle burn-in inputs and wires the burn-in processor", async () => {
  const processor = (() => ({})) as unknown as SubtitleProcessor;
  let capturedOptions: ConversionOptions | undefined;
  let processorCueCount = 0;
  const context = createRuntime({
    buildSubtitleBurnInProcessor: (cues) => {
      processorCueCount = cues.length;
      return processor;
    },
    initConversion: async (options) => {
      capturedOptions = options;
      return createConversion({
        target: context.target,
        bytes: [1],
        utilizedAudio: true,
      });
    },
  });

  await assert.rejects(
    () =>
      exportClipWithRuntime(
        {
          mediaSource,
          startTime: 0,
          endTime: 10,
          format: "mp4",
          resolution: "original",
          includeAudio: true,
          includeBurnedSubtitles: true,
          subtitleCues: [
            {
              startTime: 1,
              endTime: 2,
              text: "Hello",
              lines: ["Hello"],
            },
          ],
          onProgress: () => undefined,
        },
        context.runtime,
      ),
    /Subtitle burn-in was requested without style settings/,
  );

  const blob = await exportClipWithRuntime(
    {
      mediaSource,
      startTime: 0,
      endTime: 10,
      format: "mp4",
      resolution: "original",
      includeAudio: true,
      includeBurnedSubtitles: true,
      subtitleStyleSettings: subtitleStyle,
      subtitleCues: [
        {
          startTime: 1,
          endTime: 2,
          text: "Hello",
          lines: ["Hello"],
        },
      ],
      onProgress: () => undefined,
    },
    context.runtime,
  );

  assert.equal(blob.size, 1);
  const videoOptionsForTrack = capturedOptions?.video;
  assert.equal(typeof videoOptionsForTrack, "function");
  if (typeof videoOptionsForTrack !== "function") {
    throw new Error("Expected video conversion options to be a function");
  }
  const videoOptions = videoOptionsForTrack(
    { id: "video-1" } as unknown as Parameters<typeof videoOptionsForTrack>[0],
    1,
  ) as { process?: unknown };
  assert.equal(processorCueCount, 1);
  assert.equal(videoOptions.process, processor);
});
