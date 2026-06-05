/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { QUALITY_LOW, QUALITY_MEDIUM } from "mediabunny";
import type { ConversionOptions } from "mediabunny";
import type { Palette } from "@techsquidtv/gifenc";
import { createGifCanvas, exportClipWithRuntime } from "@/lib/exportClip";
import type { EditorMediaSource } from "@/lib/editorMedia";
import { gifExportSettingsForPreset } from "@/lib/exportTypes";
import { createInlineGifFrameEncoder } from "@/lib/gifFrameEncoder";
import { concatenateGifFrameChunks } from "@/lib/gifFrameChunk";
import type { EncodeGifFrameChunkHelpers } from "@/lib/gifFrameChunk";
import type { SubtitleStyleSettings } from "@/lib/subtitles/types";

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
type GifEncodingRuntime = Awaited<
  ReturnType<ExportRuntime["loadGifEncodingRuntime"]>
>;
type CreateGifEncoder = NonNullable<
  EncodeGifFrameChunkHelpers["createGifEncoder"]
>;
type QuantizeGifFrame = NonNullable<
  EncodeGifFrameChunkHelpers["quantizeGifFrame"]
>;
type ApplyGifPalette = NonNullable<
  EncodeGifFrameChunkHelpers["applyGifPalette"]
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

function createMockGifEncoder(): ReturnType<CreateGifEncoder> {
  return {
    bytes: () => new Uint8Array([71, 73, 70]),
    bytesView: () => new Uint8Array([71, 73, 70]),
    finish: () => {},
    reset: () => {},
    writeHeader: () => {},
    writeFrame: () => {},
  } as unknown as ReturnType<CreateGifEncoder>;
}

function createMockGifRuntime({
  createGifEncoder = createMockGifEncoder,
  quantizeGifFrame = (() => [[0, 0, 0]] as Palette) as QuantizeGifFrame,
  applyGifPalette = (() => new Uint8Array([0])) as ApplyGifPalette,
}: Partial<{
  createGifEncoder: CreateGifEncoder;
  quantizeGifFrame: QuantizeGifFrame;
  applyGifPalette: ApplyGifPalette;
}> = {}): GifEncodingRuntime {
  return {
    quantizeGifFrame,
    createGifFrameEncoder: () =>
      createInlineGifFrameEncoder({
        createGifEncoder,
        quantizeGifFrame,
        applyGifPalette,
      }),
    concatenateGifFrameChunks,
  };
}

function createRuntime(overrides: Partial<ExportRuntime> = {}) {
  const target = { buffer: undefined as ArrayBuffer | undefined };
  const videoTrack = {
    id: "video-1",
    hasOnlyKeyPackets: async () => false,
    canBeTransparent: async () => false,
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

  const runtime: ExportRuntime = {
    ensureMediabunnyCodecs: async () => {},
    createCliparrInputFromSource: async () => input,
    selectPreferredPairableAudioTrack: async (_videoTrack, audioTracks) =>
      audioTracks[0] ?? null,
    getTrackTimelineOffsetSeconds: async () => 5,
    getVideoTrackDimensions: async () => ({ width: 1920, height: 1080 }),
    buildMetadataTags: async () => ({ title: "Clip" }),
    describeDiscardedTracks: async () => "",
    patchMp4MetadataBoxes: () => {},
    createOutputFormat: () =>
      ({ mimeType: "video/mp4" }) as unknown as OutputFormat,
    createBufferTarget: () => target as unknown as BufferTargetResult,
    createOutput: (options) => ({ options }) as unknown as OutputResult,
    createCanvasSink: () =>
      ({
        getCanvas: async () => null,
      }) as unknown as ReturnType<ExportRuntime["createCanvasSink"]>,
    createGifCanvas: () =>
      ({
        canvas: {},
        context: {
          clearRect: () => {},
          drawImage: () => {},
          getImageData: () => ({
            data: new Uint8ClampedArray(4),
          }),
        },
      }) as unknown as ReturnType<ExportRuntime["createGifCanvas"]>,
    loadGifEncodingRuntime: async () => createMockGifRuntime(),
    getActiveSubtitleCue: () => {},
    renderSubtitleCue: () => {},
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
  context.runtime.loadGifEncodingRuntime = async () => {
    throw new Error("GIF encoder should not load for video exports");
  };
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
    throw new TypeError("Expected audio conversion options to be a function");
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
    throw new TypeError("Expected video conversion options to be a function");
  }
  const selectedVideoOptions = videoOptionsForTrack(
    { id: "video-1" } as unknown as Parameters<typeof videoOptionsForTrack>[0],
    1,
  ) as {
    discard: boolean;
    height?: number;
    forceTranscode?: boolean;
    bitrate?: unknown;
  };
  const otherVideoOptions = videoOptionsForTrack(
    { id: "video-2" } as unknown as Parameters<typeof videoOptionsForTrack>[0],
    2,
  ) as { discard: boolean; height?: number };
  assert.equal(selectedVideoOptions.discard, false);
  assert.equal(selectedVideoOptions.height, 720);
  assert.equal(selectedVideoOptions.forceTranscode, undefined);
  assert.equal(selectedVideoOptions.bitrate, undefined);
  assert.equal(otherVideoOptions.discard, true);
});

void test("forces video transcode for compact and balanced export quality", async () => {
  const qualityCases = [
    ["compact", QUALITY_LOW],
    ["balanced", QUALITY_MEDIUM],
  ] as const;

  for (const [videoQuality, expectedBitrate] of qualityCases) {
    let capturedOptions: ConversionOptions | undefined;
    const context = createRuntime({
      initConversion: async (options) => {
        capturedOptions = options;
        return createConversion({
          target: context.target,
          bytes: [1],
          utilizedAudio: false,
        });
      },
    });

    await exportClipWithRuntime(
      {
        mediaSource,
        startTime: 0,
        endTime: 5,
        format: "mp4",
        resolution: "original",
        videoQuality,
        includeAudio: false,
        onProgress: () => {},
      },
      context.runtime,
    );

    const videoOptionsForTrack = capturedOptions?.video;
    assert.equal(typeof videoOptionsForTrack, "function");
    if (typeof videoOptionsForTrack !== "function") {
      throw new TypeError("Expected video conversion options to be a function");
    }

    const selectedVideoOptions = videoOptionsForTrack(
      { id: "video-1" } as unknown as Parameters<
        typeof videoOptionsForTrack
      >[0],
      1,
    ) as {
      discard: boolean;
      forceTranscode?: boolean;
      bitrate?: unknown;
    };

    assert.equal(selectedVideoOptions.discard, false);
    assert.equal(selectedVideoOptions.forceTranscode, true);
    assert.equal(selectedVideoOptions.bitrate, expectedBitrate);
    assert.equal(context.disposed, true);
  }
});

void test("creates GIF render canvases with frequent readback enabled", () => {
  const previousDocument = globalThis.document;
  let contextOptions:
    | (CanvasRenderingContext2DSettings & { willReadFrequently?: boolean })
    | undefined;
  const fakeContext = {} as CanvasRenderingContext2D;
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext(type: string, options?: CanvasRenderingContext2DSettings) {
      assert.equal(type, "2d");
      contextOptions = options;

      return fakeContext;
    },
  } as unknown as HTMLCanvasElement;

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement(tagName: string) {
        assert.equal(tagName, "canvas");

        return fakeCanvas;
      },
    },
  });

  try {
    const { canvas, context } = createGifCanvas(320, 180);

    assert.equal(canvas, fakeCanvas);
    assert.equal(context, fakeContext);
    assert.equal(canvas.width, 320);
    assert.equal(canvas.height, 180);
    assert.deepEqual(contextOptions, { willReadFrequently: true });
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument,
    });
  }
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
          onProgress: () => {},
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
          onProgress: () => {},
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
      onProgress: () => {},
    },
    context.runtime,
  );

  assert.equal(blob.size, 1);
  const videoOptionsForTrack = capturedOptions?.video;
  assert.equal(typeof videoOptionsForTrack, "function");
  if (typeof videoOptionsForTrack !== "function") {
    throw new TypeError("Expected video conversion options to be a function");
  }
  const videoOptions = videoOptionsForTrack(
    { id: "video-1" } as unknown as Parameters<typeof videoOptionsForTrack>[0],
    1,
  ) as { process?: unknown };
  assert.equal(processorCueCount, 1);
  assert.equal(videoOptions.process, processor);
});

void test("exports GIF frames through the browser encoder path", async () => {
  const gifSettings = gifExportSettingsForPreset("compact");
  const timestamps: string[] = [];
  const progress: Array<{
    progress: number;
  }> = [];
  const writtenFrames: Array<{
    delay?: number;
    first?: boolean;
    height: number;
    width: number;
  }> = [];
  const quantizeCalls: Array<{ byteLength: number; maxColors: number }> = [];
  const globalPalette = [
    [0, 0, 0],
    [255, 255, 255],
  ] satisfies Array<[number, number, number]>;
  const gifContext = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    clearRect: () => {},
    drawImage: () => {},
    getImageData: () => ({
      data: new Uint8ClampedArray(4 * 4 * 4),
    }),
  };
  let canvasSinkOptions: { fit?: string; height?: number } | undefined;
  const createGifEncoder: CreateGifEncoder = () => {
    let gifByteLength = 0;

    return {
      bytes: () => new Uint8Array(gifByteLength),
      bytesView: () => new Uint8Array(gifByteLength),
      finish: () => {},
      reset: () => {},
      writeHeader: () => {},
      writeFrame: (
        _index: Uint8Array,
        width: number,
        height: number,
        options?: { delay?: number; first?: boolean },
      ) => {
        writtenFrames.push({
          delay: options?.delay,
          first: options?.first,
          height,
          width,
        });
        gifByteLength = 4;
      },
    } as unknown as ReturnType<CreateGifEncoder>;
  };
  const quantizeGifFrame: QuantizeGifFrame = (rgba, maxColors) => {
    quantizeCalls.push({ byteLength: rgba.length, maxColors });
    return globalPalette;
  };
  const applyGifPalette: ApplyGifPalette = (rgba, palette) => {
    assert.equal(rgba.length, 4 * 4 * 4);
    assert.equal(palette, globalPalette);
    return new Uint8Array(4 * 4);
  };
  const context = createRuntime({
    buildMetadataTags: async () => {
      throw new Error("metadata should not be built for GIF exports");
    },
    createOutputFormat: () => {
      throw new Error("Mediabunny output format should not be used for GIFs");
    },
    getVideoTrackDimensions: async () => ({ width: 4, height: 4 }),
    createCanvasSink: (_track, options) => {
      canvasSinkOptions = options;
      return {
        getCanvas: async (timestamp: number) => {
          timestamps.push(timestamp.toFixed(4));
          return {
            canvas: {},
            timestamp,
            duration: 1 / gifSettings.frameRate,
          };
        },
      } as unknown as ReturnType<ExportRuntime["createCanvasSink"]>;
    },
    createGifCanvas: (width, height) =>
      ({
        canvas: { height, width },
        context: gifContext,
      }) as unknown as ReturnType<ExportRuntime["createGifCanvas"]>,
    loadGifEncodingRuntime: async () =>
      createMockGifRuntime({
        createGifEncoder,
        quantizeGifFrame,
        applyGifPalette,
      }),
    initConversion: async () => {
      throw new Error("Mediabunny conversion should not run for GIFs");
    },
  });

  const blob = await exportClipWithRuntime(
    {
      mediaSource,
      startTime: 10,
      endTime: 10 + 2 / gifSettings.frameRate,
      format: "gif",
      resolution: "original",
      gifSettings,
      includeAudio: true,
      metadata: {
        providerId: "plex",
        itemType: "movie",
        title: "Movie",
      },
      onProgress: (value) => progress.push({ progress: value }),
    },
    context.runtime,
  );

  assert.equal(blob.type, "image/gif");
  assert.equal(blob.size, 9);
  assert.deepEqual(timestamps, ["15.0000", "15.1000", "15.0000", "15.1000"]);
  assert.deepEqual(quantizeCalls, [
    {
      byteLength: 2 * 4 * 4 * 4,
      maxColors: gifSettings.maxColors,
    },
  ]);
  assert.deepEqual(progress, [
    {
      progress: 0.06,
    },
    {
      progress: 0.12,
    },
    {
      progress: 0.56,
    },
    {
      progress: 1,
    },
  ]);
  assert.equal(canvasSinkOptions?.fit, "contain");
  assert.equal(canvasSinkOptions?.height, 4);
  assert.equal(gifContext.imageSmoothingEnabled, true);
  assert.equal(gifContext.imageSmoothingQuality, "high");
  assert.deepEqual(writtenFrames, [
    {
      delay: 1000 / gifSettings.frameRate,
      first: true,
      height: 4,
      width: 4,
    },
    {
      delay: 1000 / gifSettings.frameRate,
      first: false,
      height: 4,
      width: 4,
    },
  ]);
  assert.equal(context.disposed, true);
});

void test("uses per-frame GIF palettes for the sharp preset", async () => {
  const gifSettings = gifExportSettingsForPreset("sharp");
  const timestamps: string[] = [];
  const quantizeCalls: Array<{ byteLength: number; maxColors: number }> = [];
  const quantizeGifFrame: QuantizeGifFrame = (rgba, maxColors) => {
    quantizeCalls.push({ byteLength: rgba.length, maxColors });
    return [[0, 0, 0]];
  };
  const context = createRuntime({
    getVideoTrackDimensions: async () => ({ width: 4, height: 4 }),
    createCanvasSink: () =>
      ({
        getCanvas: async (timestamp: number) => {
          timestamps.push(timestamp.toFixed(4));
          return {
            canvas: {},
            timestamp,
            duration: 1 / gifSettings.frameRate,
          };
        },
      }) as unknown as ReturnType<ExportRuntime["createCanvasSink"]>,
    createGifCanvas: (width, height) =>
      ({
        canvas: { height, width },
        context: {
          clearRect: () => {},
          drawImage: () => {},
          getImageData: () => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
        },
      }) as unknown as ReturnType<ExportRuntime["createGifCanvas"]>,
    loadGifEncodingRuntime: async () =>
      createMockGifRuntime({ quantizeGifFrame }),
  });

  await exportClipWithRuntime(
    {
      mediaSource,
      startTime: 10,
      endTime: 10 + 2 / gifSettings.frameRate,
      format: "gif",
      resolution: "original",
      gifSettings,
      includeAudio: false,
      onProgress: () => {},
    },
    context.runtime,
  );

  assert.deepEqual(timestamps, ["15.0000", "15.0556"]);
  assert.deepEqual(quantizeCalls, [
    {
      byteLength: 4 * 4 * 4,
      maxColors: gifSettings.maxColors,
    },
    {
      byteLength: 4 * 4 * 4,
      maxColors: gifSettings.maxColors,
    },
  ]);
});

void test("renders subtitles when burning cues into GIF frames", async () => {
  const gifSettings = gifExportSettingsForPreset("sharp");
  let renderedSubtitleCount = 0;
  let activeSubtitleTimestamp: number | undefined;
  const context = createRuntime({
    getVideoTrackDimensions: async () => ({ width: 4, height: 4 }),
    createCanvasSink: () =>
      ({
        getCanvas: async () => ({
          canvas: {},
          timestamp: 5,
          duration: 1 / gifSettings.frameRate,
        }),
      }) as unknown as ReturnType<ExportRuntime["createCanvasSink"]>,
    createGifCanvas: (width, height) =>
      ({
        canvas: { height, width },
        context: {
          clearRect: () => {},
          drawImage: () => {},
          getImageData: () => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
        },
      }) as unknown as ReturnType<ExportRuntime["createGifCanvas"]>,
    getActiveSubtitleCue: (cues, timestamp) => {
      activeSubtitleTimestamp = timestamp;
      return cues[0];
    },
    renderSubtitleCue: (_context, cue, _styleSettings, width, height) => {
      assert.equal(cue.text, "Hello");
      assert.equal(width, 4);
      assert.equal(height, 4);
      renderedSubtitleCount += 1;
    },
  });

  await exportClipWithRuntime(
    {
      mediaSource,
      startTime: 10,
      endTime: 10 + 1 / gifSettings.frameRate,
      format: "gif",
      resolution: "original",
      gifSettings,
      includeAudio: false,
      includeBurnedSubtitles: true,
      subtitleStyleSettings: subtitleStyle,
      subtitleCues: [
        {
          startTime: 10,
          endTime: 11,
          text: "Hello",
          lines: ["Hello"],
        },
      ],
      onProgress: () => {},
    },
    context.runtime,
  );

  assert.equal(activeSubtitleTimestamp, 0);
  assert.equal(renderedSubtitleCount, 1);
});
