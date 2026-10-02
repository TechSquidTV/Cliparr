import { createPcmWav } from "#/lib/exportAudioFixtures.test-support";
import { ensureAudioEncoder } from "#/lib/mediabunnyCodecs";
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  Input,
  MovOutputFormat,
  Output,
} from "mediabunny";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createCliparrInputFromSource,
  type ExportClipOptions,
  type ExportPhase,
} from "@cliparr/frontend/convert";
import {
  buildConvertedFileBaseName,
  buildConvertedFileName,
  buildConvertedOutputFileName,
  buildLocalFileSource,
  runConvertExport,
  probeConvertSource,
} from "@/components/convert/convertToolUtilities";

function createVideoFile(name = "Demo Clip.mov") {
  return new File(["video"], name, {
    type: "video/quicktime",
    lastModified: 1234,
  });
}

function assertExportClipOptions(
  value: ExportClipOptions | null,
): asserts value is ExportClipOptions {
  assert.ok(value);
}

void test("buildLocalFileSource creates a Cliparr local-file source", () => {
  const file = createVideoFile();
  const source = buildLocalFileSource(file);

  assert.equal(source.kind, "file");
  assert.equal(source.role, "local-file");
  assert.equal(source.file, file);
  assert.equal(source.fileName, "Demo Clip.mov");
  assert.equal(source.mimeType, "video/quicktime");
  assert.equal(source.size, file.size);
  assert.equal(source.lastModified, 1234);
});

void test("buildConvertedFileName replaces the source extension", () => {
  assert.equal(
    buildConvertedFileName("Demo Clip.mov", "webm"),
    "Demo Clip.webm",
  );
  assert.equal(
    buildConvertedFileName("demo/source?.mp4", "gif"),
    "demo source.gif",
  );
});

void test("buildConvertedOutputFileName sanitizes custom names and applies the selected extension", () => {
  assert.equal(
    buildConvertedOutputFileName("My Custom Output.webm", "mp4"),
    "My Custom Output.mp4",
  );
  assert.equal(
    buildConvertedOutputFileName("part.one", "webm"),
    "part.one.webm",
  );
  assert.equal(
    buildConvertedOutputFileName("   ", "mkv"),
    "converted-video.mkv",
  );
  assert.equal(buildConvertedFileBaseName("nested/name?.mov"), "nested name");
});

void test("runConvertExport forwards options, progress, and download", async () => {
  const file = createVideoFile("source.mp4");
  const source = buildLocalFileSource(file);
  const progressValues: number[] = [];
  const downloaded: Array<{ blob: Blob; fileName: string }> = [];
  const received: { options: ExportClipOptions | null } = {
    options: null,
  };
  const outputBlob = new Blob(["converted"], { type: "video/webm" });

  const result = await runConvertExport(
    {
      source,
      fileName: "source.webm",
      probe: {
        durationSeconds: 42,
        previewStartTimestampSeconds: 0,
        dimensions: { width: 1920, height: 1080 },
        hasAudio: true,
        hasVideo: true,
      },
      format: "webm",
      resolution: "720",
      videoQuality: "balanced",
      mode: "video-audio",
      onProgress: (progress) => progressValues.push(progress),
    },
    {
      exportClip: async (options) => {
        received.options = options;
        options.onProgress(0.42);
        return outputBlob;
      },
      downloadBlob: (blob, fileName) => {
        downloaded.push({ blob, fileName });
      },
    },
  );

  assert.equal(result, outputBlob);
  assertExportClipOptions(received.options);
  assert.equal(received.options.mediaSource, source);
  assert.equal(received.options.startTime, 0);
  assert.equal(received.options.endTime, 42);
  assert.equal(received.options.format, "webm");
  assert.equal(received.options.resolution, "720");
  assert.equal(received.options.videoQuality, "balanced");
  assert.equal(received.options.mode, "video-audio");
  assert.deepEqual(progressValues, [0.42]);
  assert.deepEqual(downloaded, [{ blob: outputBlob, fileName: "source.webm" }]);
});

void test("runConvertExport propagates export errors without downloading", async () => {
  const source = buildLocalFileSource(createVideoFile());
  let downloaded = false;

  await assert.rejects(
    runConvertExport(
      {
        source,
        fileName: "failed.mp4",
        probe: {
          durationSeconds: 12,
          previewStartTimestampSeconds: 0,
          dimensions: { width: 1280, height: 720 },
          hasAudio: false,
          hasVideo: true,
        },
        format: "mp4",
        resolution: "original",
        videoQuality: "sharp",
        mode: "video-only",
        onProgress: () => {},
      },
      {
        exportClip: async () => {
          throw new Error("No compatible codec.");
        },
        downloadBlob: () => {
          downloaded = true;
        },
      },
    ),
    /No compatible codec/,
  );
  assert.equal(downloaded, false);
});

void test("audio-only source probing uses export track selection and releases its input", async () => {
  const file = createPcmWav({
    bits: 16,
    samples: Array.from({ length: 480 }, () => 0),
  });
  const source = buildLocalFileSource(file);
  let disposed = false;
  const result = await probeConvertSource(
    source,
    true,
    undefined,
    async (source) => {
      const input = await createCliparrInputFromSource(source);
      input.getPrimaryAudioTrack = async () =>
        assert.fail("Use the shared export audio selector");
      const dispose = input.dispose.bind(input);
      input.dispose = () => {
        disposed = true;
        dispose();
      };
      return input;
    },
  );
  assert.equal(result.dimensions, null);
  assert.equal(result.videoCodec, null);
  assert.equal(result.hasAudio, true);
  assert.equal(result.durationSeconds, 0.01);
  assert.equal(disposed, true);
  const initialProbe = await probeConvertSource(source, false);
  assert.equal(initialProbe.hasVideo, false);
  assert.equal(initialProbe.hasAudio, true);
  assert.equal(initialProbe.durationSeconds, result.durationSeconds);
});

void test("audio-only probing and conversion preserve the full selected track when the default track is shorter", async () => {
  await ensureAudioEncoder("pcm-s16");
  const target = new BufferTarget();
  const output = new Output({ target, format: new MovOutputFormat() });
  const first = new AudioSampleSource({ codec: "pcm-s16" });
  const second = new AudioSampleSource({ codec: "pcm-s16" });
  output.addAudioTrack(first, { disposition: { default: false } });
  output.addAudioTrack(second, { disposition: { default: true } });
  await output.start();
  for (const [track, seconds] of [
    [first, 10],
    [second, 2],
  ] as const) {
    const sample = new AudioSample({
      data: new Int16Array(8000 * seconds).fill(track === first ? 2000 : 6000),
      format: "s16",
      sampleRate: 8000,
      numberOfChannels: 1,
      timestamp: 0,
    });
    try {
      await track.add(sample);
    } finally {
      sample.close();
      track.close();
    }
  }
  await output.finalize();
  assert.ok(target.buffer);
  const file = new File([target.buffer], "two-tracks.mov");
  const source = buildLocalFileSource(file);
  const probe = await probeConvertSource(source, true);
  assert.equal(probe.durationSeconds, 10);
  const { exportClip } = await import("#/lib/exportClip");
  const blob = await runConvertExport(
    {
      source,
      fileName: "complete.wav",
      probe,
      format: "wav",
      resolution: "original",
      mode: "audio-only",
      onProgress: () => {},
    },
    {
      exportClip,
      downloadBlob: () => {},
    },
  );
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  try {
    assert.equal(await input.computeDuration(), 10);
  } finally {
    input.dispose();
  }
});

void test("cancelled source probing never opens a new input", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    probeConvertSource(
      buildLocalFileSource(createVideoFile()),
      true,
      controller.signal,
      async () => assert.fail("Unexpected input"),
    ),
    { name: "AbortError" },
  );
});

for (const cancellationPoint of [
  "before",
  "preparing",
  "encoding",
  "finalizing",
] as const) {
  void test(`converter cancellation during ${cancellationPoint} prevents downloads and permits retry`, async () => {
    const controller = new AbortController();
    const phases: string[] = [];
    let exports = 0;
    let downloads = 0;
    const options = {
      source: buildLocalFileSource(createVideoFile()),
      fileName: "audio.wav",
      probe: {
        durationSeconds: 1,
        previewStartTimestampSeconds: 0,
        dimensions: null,
        hasAudio: true,
        hasVideo: false,
      },
      format: "wav" as const,
      mode: "audio-only" as const,
      resolution: "original" as const,
      onProgress: () => {},
      onPhaseChange: (phase: ExportPhase) => {
        phases.push(phase);
      },
    };
    const dependencies = {
      exportClip: async (received: ExportClipOptions) => {
        exports++;
        assert.equal(received.signal, controller.signal);
        for (const phase of ["preparing", "encoding", "finalizing"] as const) {
          received.onPhaseChange?.(phase);
          if (phase === cancellationPoint) {
            controller.abort();
            if (phase !== "finalizing") {
              received.signal?.throwIfAborted();
            }
          }
        }
        // Simulate an engine completing concurrently with cancellation.
        return new Blob(["finished"]);
      },
      downloadBlob: () => {
        downloads++;
      },
    };
    if (cancellationPoint === "before") {
      controller.abort();
    }
    await assert.rejects(
      runConvertExport({ ...options, signal: controller.signal }, dependencies),
      { name: "AbortError" },
    );
    assert.equal(downloads, 0);
    assert.equal(exports, cancellationPoint === "before" ? 0 : 1);
    assert.deepEqual(
      phases,
      cancellationPoint === "before"
        ? []
        : ["preparing", "encoding", "finalizing"].slice(
            0,
            ["preparing", "encoding", "finalizing"].indexOf(cancellationPoint) +
              1,
          ),
    );
    await runConvertExport(
      { ...options, signal: new AbortController().signal },
      {
        ...dependencies,
        exportClip: async (received) => {
          assert.equal(received.signal?.aborted, false);
          return new Blob(["retry"]);
        },
      },
    );
    assert.equal(downloads, 1);
  });
}
