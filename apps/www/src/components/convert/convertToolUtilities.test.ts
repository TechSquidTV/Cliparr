import assert from "node:assert/strict";
import test from "node:test";
import type { ExportClipOptions } from "@cliparr/frontend/convert";
import {
  buildConvertedFileBaseName,
  buildConvertedFileName,
  buildConvertedOutputFileName,
  buildLocalFileSource,
  resolveConvertIncludeAudio,
  runConvertExport,
  selectedQualityForFormat,
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

void test("format changes resolve audio and quality state", () => {
  assert.equal(resolveConvertIncludeAudio("mp4", true), true);
  assert.equal(resolveConvertIncludeAudio("gif", true), false);
  assert.equal(
    selectedQualityForFormat({
      format: "gif",
      gifPreset: "efficient",
      videoQuality: "sharp",
    }),
    "efficient",
  );
  assert.equal(
    selectedQualityForFormat({
      format: "mp4",
      gifPreset: "efficient",
      videoQuality: "balanced",
    }),
    "balanced",
  );
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
      },
      format: "webm",
      resolution: "720",
      videoQuality: "balanced",
      includeAudio: true,
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
  assert.equal(received.options.includeAudio, true);
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
        },
        format: "mp4",
        resolution: "original",
        videoQuality: "sharp",
        includeAudio: false,
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
