import * as Sentry from "@sentry/astro";
import {
  EXPORT_SIZE_ESTIMATE_ALGORITHM_VERSION,
  type ExportFormat,
  type ExportOutputDimensions,
  type ExportQualityPreset,
  type ExportResolution,
  type ExportSizeEstimate,
  type GifExportSettings,
} from "@cliparr/frontend/convert";
import type { SourceProbeResult } from "@/components/convert/convertToolUtilities";

type ConvertSourceFormat =
  | "gif"
  | "mkv"
  | "mov"
  | "mp4"
  | "mpeg-ts"
  | "ogg"
  | "unknown"
  | "webm";

type MetricAttributeValue = boolean | number | string;

interface MetricOptions {
  attributes?: Record<string, MetricAttributeValue>;
  unit?: string;
}

interface ConvertMetricsClient {
  count: (name: string, value?: number, options?: MetricOptions) => void;
  distribution: (name: string, value: number, options?: MetricOptions) => void;
}

export interface ConvertMetricsDependencies {
  metrics: ConvertMetricsClient;
  flush: (timeout?: number) => PromiseLike<boolean>;
}

interface SourceFormatInput {
  name?: string;
  type?: string;
}

interface ConvertExportMetricContext {
  sourceFile: SourceFormatInput & { size: number };
  probe: SourceProbeResult;
  format: ExportFormat;
  selectedQuality: ExportQualityPreset;
  resolution: ExportResolution;
  includeAudio: boolean;
  outputDimensions: ExportOutputDimensions | null;
  outputSizeEstimate: ExportSizeEstimate;
  gifSettings?: GifExportSettings | null;
}

interface ConvertExportCompletedMetricInput extends ConvertExportMetricContext {
  actualBytes: number;
  durationMs: number;
}

interface ConvertExportFailedMetricInput extends ConvertExportMetricContext {
  durationMs: number;
}

export type ConvertPwaInstallFormFactor = "desktop" | "mobile";
type ConvertPwaInstallMode = "ios" | "native";

export interface ConvertPwaInstallMetricInput {
  formFactor: ConvertPwaInstallFormFactor;
  installMode: ConvertPwaInstallMode;
}

const convertMetricsFlushTimeoutMs = 2000;
const defaultConvertMetricsDependencies: ConvertMetricsDependencies = {
  metrics: Sentry.metrics,
  flush: Sentry.flush,
};
const sourceFormatByExtension: ReadonlyMap<string, ConvertSourceFormat> =
  new Map([
    ["gif", "gif"],
    ["m2ts", "mpeg-ts"],
    ["m4v", "mp4"],
    ["mkv", "mkv"],
    ["mov", "mov"],
    ["mp4", "mp4"],
    ["mts", "mpeg-ts"],
    ["ogm", "ogg"],
    ["ogg", "ogg"],
    ["ogv", "ogg"],
    ["qt", "mov"],
    ["ts", "mpeg-ts"],
    ["webm", "webm"],
  ]);
const sourceFormatByMimeType: ReadonlyMap<string, ConvertSourceFormat> =
  new Map([
    ["application/mp4", "mp4"],
    ["application/ogg", "ogg"],
    ["application/webm", "webm"],
    ["application/x-matroska", "mkv"],
    ["image/gif", "gif"],
    ["video/gif", "gif"],
    ["video/mp2t", "mpeg-ts"],
    ["video/mp4", "mp4"],
    ["video/ogg", "ogg"],
    ["video/quicktime", "mov"],
    ["video/webm", "webm"],
    ["video/x-m4v", "mp4"],
    ["video/x-matroska", "mkv"],
  ]);

export function normalizeConvertSourceFormat(
  source: SourceFormatInput | null,
): ConvertSourceFormat {
  const extension = source?.name
    ?.trim()
    .match(/\.([^.]+)$/)
    ?.at(1)
    ?.toLowerCase();
  const extensionFormat = extension
    ? sourceFormatByExtension.get(extension)
    : undefined;

  if (extensionFormat) {
    return extensionFormat;
  }

  const normalizedMimeType = source?.type
    ?.trim()
    .toLowerCase()
    .split(";", 1)[0];

  return normalizedMimeType
    ? (sourceFormatByMimeType.get(normalizedMimeType) ?? "unknown")
    : "unknown";
}

export function buildConvertMetricAttributes({
  sourceFile,
  probe,
  format,
  selectedQuality,
  resolution,
  includeAudio,
  outputDimensions,
  outputSizeEstimate,
  gifSettings,
}: ConvertExportMetricContext) {
  return compactMetricAttributes({
    surface: "www.convert",
    "estimator.version": EXPORT_SIZE_ESTIMATE_ALGORITHM_VERSION,
    "source.format": normalizeConvertSourceFormat(sourceFile),
    "output.format": format,
    "export.quality": selectedQuality,
    "export.resolution": resolution,
    "export.include_audio": includeAudio,
    "source.has_audio": probe.hasAudio,
    "output.width": outputDimensions?.width,
    "output.height": outputDimensions?.height,
    "estimate.basis": outputSizeEstimate.basis,
    "gif.frame_rate": format === "gif" ? gifSettings?.frameRate : undefined,
    "gif.max_colors": format === "gif" ? gifSettings?.maxColors : undefined,
    "gif.palette_mode":
      format === "gif"
        ? stringMetricAttribute(gifSettings?.paletteMode)
        : undefined,
    "gif.dither_mode":
      format === "gif"
        ? stringMetricAttribute(gifSettings?.ditherMode)
        : undefined,
  });
}

export function recordConvertExportStarted(
  context: ConvertExportMetricContext,
  dependencies: ConvertMetricsDependencies = defaultConvertMetricsDependencies,
) {
  recordCount(
    dependencies.metrics,
    "convert.export.started",
    buildConvertMetricAttributes(context),
  );
}

export function recordConvertExportCompleted(
  input: ConvertExportCompletedMetricInput,
  dependencies: ConvertMetricsDependencies = defaultConvertMetricsDependencies,
) {
  const attributes = buildConvertMetricAttributes(input);
  const estimateBytes = input.outputSizeEstimate.bytes;

  recordCount(dependencies.metrics, "convert.export.completed", attributes);
  recordDistribution(
    dependencies.metrics,
    "convert.source.size_bytes",
    input.sourceFile.size,
    "byte",
    attributes,
  );
  recordDistribution(
    dependencies.metrics,
    "convert.source.duration_seconds",
    input.probe.durationSeconds,
    "second",
    attributes,
  );
  recordDistribution(
    dependencies.metrics,
    "convert.estimate.bytes",
    estimateBytes,
    "byte",
    attributes,
  );
  recordDistribution(
    dependencies.metrics,
    "convert.output.bytes",
    input.actualBytes,
    "byte",
    attributes,
  );
  recordDistribution(
    dependencies.metrics,
    "convert.export.duration_ms",
    input.durationMs,
    "millisecond",
    attributes,
  );

  if (typeof estimateBytes !== "number" || estimateBytes <= 0) {
    return;
  }

  recordDistribution(
    dependencies.metrics,
    "convert.estimate.delta_bytes",
    input.actualBytes - estimateBytes,
    "byte",
    attributes,
  );
  recordDistribution(
    dependencies.metrics,
    "convert.estimate.ratio",
    Number((input.actualBytes / estimateBytes).toFixed(3)),
    undefined,
    attributes,
  );
}

export function recordConvertExportFailed(
  input: ConvertExportFailedMetricInput,
  dependencies: ConvertMetricsDependencies = defaultConvertMetricsDependencies,
) {
  recordCount(
    dependencies.metrics,
    "convert.export.failed",
    buildConvertMetricAttributes(input),
  );
}

export async function flushConvertMetrics(
  dependencies: ConvertMetricsDependencies = defaultConvertMetricsDependencies,
) {
  try {
    return await dependencies.flush(convertMetricsFlushTimeoutMs);
  } catch {
    return false;
  }
}

export function recordConvertPwaInstallPromptAvailable(
  input: ConvertPwaInstallMetricInput,
  dependencies: ConvertMetricsDependencies = defaultConvertMetricsDependencies,
) {
  recordConvertPwaInstallMetric(
    "convert.pwa.install.prompt.available",
    input,
    dependencies,
  );
}

export function recordConvertPwaInstallPromptShown(
  input: ConvertPwaInstallMetricInput,
  dependencies: ConvertMetricsDependencies = defaultConvertMetricsDependencies,
) {
  recordConvertPwaInstallMetric(
    "convert.pwa.install.prompt.shown",
    input,
    dependencies,
  );
}

export function recordConvertPwaInstallClicked(
  input: ConvertPwaInstallMetricInput,
  dependencies: ConvertMetricsDependencies = defaultConvertMetricsDependencies,
) {
  recordConvertPwaInstallMetric(
    "convert.pwa.install.clicked",
    input,
    dependencies,
  );
}

export function recordConvertPwaInstallAccepted(
  input: ConvertPwaInstallMetricInput,
  dependencies: ConvertMetricsDependencies = defaultConvertMetricsDependencies,
) {
  recordConvertPwaInstallMetric(
    "convert.pwa.install.accepted",
    input,
    dependencies,
  );
}

export function recordConvertPwaInstallDismissed(
  input: ConvertPwaInstallMetricInput,
  dependencies: ConvertMetricsDependencies = defaultConvertMetricsDependencies,
) {
  recordConvertPwaInstallMetric(
    "convert.pwa.install.dismissed",
    input,
    dependencies,
  );
}

export function recordConvertPwaInstalled(
  input: ConvertPwaInstallMetricInput,
  dependencies: ConvertMetricsDependencies = defaultConvertMetricsDependencies,
) {
  recordConvertPwaInstallMetric("convert.pwa.installed", input, dependencies);
}

function compactMetricAttributes(
  fields: Record<string, MetricAttributeValue | undefined>,
) {
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, MetricAttributeValue] =>
        entry[1] !== undefined,
    ),
  );
}

function recordConvertPwaInstallMetric(
  name: string,
  input: ConvertPwaInstallMetricInput,
  dependencies: ConvertMetricsDependencies,
) {
  recordCount(dependencies.metrics, name, {
    surface: "www.convert",
    form_factor: input.formFactor,
    install_mode: input.installMode,
  });
}

function recordCount(
  metrics: ConvertMetricsClient,
  name: string,
  attributes: Record<string, MetricAttributeValue>,
) {
  try {
    metrics.count(name, 1, { attributes });
  } catch {
    return;
  }
}

function recordDistribution(
  metrics: ConvertMetricsClient,
  name: string,
  value: number | null | undefined,
  unit: string | undefined,
  attributes: Record<string, MetricAttributeValue>,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }

  try {
    metrics.distribution(name, value, {
      attributes,
      ...(unit ? { unit } : {}),
    });
  } catch {
    return;
  }
}

function stringMetricAttribute(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
