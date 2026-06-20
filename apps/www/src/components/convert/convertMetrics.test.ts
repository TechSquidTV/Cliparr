import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConvertMetricAttributes,
  flushConvertMetrics,
  normalizeConvertSourceFormat,
  recordConvertExportCompleted,
  recordConvertExportFailed,
  type ConvertMetricsDependencies,
} from "@/components/convert/convertMetrics";

type MetricCall = {
  kind: "count" | "distribution";
  name: string;
  value: number | undefined;
  options?: {
    attributes?: Record<string, unknown>;
    unit?: string;
  };
};

function createMetricRecorder() {
  const calls: MetricCall[] = [];
  const flushTimeouts: Array<number | undefined> = [];
  const dependencies: ConvertMetricsDependencies = {
    metrics: {
      count: (name, value, options) => {
        calls.push({ kind: "count", name, value, options });
      },
      distribution: (name, value, options) => {
        calls.push({ kind: "distribution", name, value, options });
      },
    },
    flush: (timeout) => {
      flushTimeouts.push(timeout);

      return Promise.resolve(true);
    },
  };

  return { calls, dependencies, flushTimeouts };
}

function createSourceFile(name = "Private Show S01E02.mkv") {
  return new File(["x".repeat(4096)], name, {
    type: "video/x-matroska",
    lastModified: 1234,
  });
}

function createMetricContext() {
  return {
    sourceFile: createSourceFile(),
    probe: {
      durationSeconds: 42,
      previewStartTimestampSeconds: 0,
      dimensions: { width: 1920, height: 1080 },
      hasAudio: true,
    },
    format: "mp4" as const,
    selectedQuality: "balanced" as const,
    resolution: "720" as const,
    includeAudio: true,
    outputDimensions: { width: 1280, height: 720 },
    outputSizeEstimate: {
      bytes: 1000,
      basis: "codec-heuristic" as const,
    },
    gifSettings: null,
  };
}

function metricCall(calls: readonly MetricCall[], name: string) {
  const call = calls.find((candidate) => candidate.name === name);

  assert.ok(call, `Expected metric ${name} to be recorded.`);

  return call;
}

void test("normalizes convert source formats from extension and MIME type", () => {
  assert.equal(
    normalizeConvertSourceFormat({ name: "Episode.MKV", type: "" }),
    "mkv",
  );
  assert.equal(
    normalizeConvertSourceFormat({ name: "capture.bin", type: "video/mp2t" }),
    "mpeg-ts",
  );
  assert.equal(
    normalizeConvertSourceFormat({ name: "phone-clip.m4v", type: "" }),
    "mp4",
  );
  assert.equal(
    normalizeConvertSourceFormat({
      name: "unknown.data",
      type: "application/octet-stream",
    }),
    "unknown",
  );
});

void test("metric attributes stay bounded and omit file-identifying values", () => {
  const attributes = buildConvertMetricAttributes(createMetricContext());
  const serializedAttributes = JSON.stringify(attributes);

  assert.equal(attributes.surface, "www.convert");
  assert.equal(attributes["source.format"], "mkv");
  assert.equal(attributes["output.format"], "mp4");
  assert.equal(attributes["estimator.version"], 1);
  assert.doesNotMatch(serializedAttributes, /Private Show/);
  assert.doesNotMatch(serializedAttributes, /S01E02/);
  assert.equal(
    Object.keys(attributes).some((key) =>
      /(?:error|file|name|path|url)/i.test(key),
    ),
    false,
  );
});

void test("completed convert metrics emit actual size, estimate delta, and ratio", () => {
  const { calls, dependencies } = createMetricRecorder();

  recordConvertExportCompleted(
    {
      ...createMetricContext(),
      actualBytes: 1100,
      durationMs: 2500,
    },
    dependencies,
  );

  assert.equal(metricCall(calls, "convert.export.completed").value, 1);
  assert.equal(metricCall(calls, "convert.source.size_bytes").value, 4096);
  assert.equal(metricCall(calls, "convert.source.duration_seconds").value, 42);
  assert.equal(metricCall(calls, "convert.estimate.bytes").value, 1000);
  assert.equal(metricCall(calls, "convert.output.bytes").value, 1100);
  assert.equal(metricCall(calls, "convert.estimate.delta_bytes").value, 100);
  assert.equal(metricCall(calls, "convert.estimate.ratio").value, 1.1);
  assert.equal(metricCall(calls, "convert.export.duration_ms").value, 2500);
  assert.equal(metricCall(calls, "convert.output.bytes").options?.unit, "byte");
});

void test("completed convert metrics skip estimate delta and ratio when unavailable", () => {
  const { calls, dependencies } = createMetricRecorder();

  recordConvertExportCompleted(
    {
      ...createMetricContext(),
      outputSizeEstimate: { bytes: null, basis: "unavailable" },
      actualBytes: 1100,
      durationMs: 2500,
    },
    dependencies,
  );

  assert.equal(
    calls.some((call) => call.name === "convert.estimate.bytes"),
    false,
  );
  assert.equal(
    calls.some((call) => call.name === "convert.estimate.delta_bytes"),
    false,
  );
  assert.equal(
    calls.some((call) => call.name === "convert.estimate.ratio"),
    false,
  );
});

void test("failed convert metrics omit raw error and file details", () => {
  const { calls, dependencies } = createMetricRecorder();

  recordConvertExportFailed(
    {
      ...createMetricContext(),
      durationMs: 2500,
    },
    dependencies,
  );

  const serializedCalls = JSON.stringify(calls);

  assert.equal(metricCall(calls, "convert.export.failed").value, 1);
  assert.doesNotMatch(serializedCalls, /No compatible codec/);
  assert.doesNotMatch(serializedCalls, /Private Show/);
  assert.doesNotMatch(serializedCalls, /S01E02/);
});

void test("convert metric flushing uses the short best-effort timeout", () => {
  const { dependencies, flushTimeouts } = createMetricRecorder();

  void flushConvertMetrics(dependencies);

  assert.deepEqual(flushTimeouts, [2000]);
});
