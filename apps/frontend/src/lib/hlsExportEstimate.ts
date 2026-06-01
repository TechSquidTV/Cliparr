import type {
  ExportOutputDimensions,
  HlsManifestBitrateBasis,
} from "@/lib/exportTypes";

export interface HlsExportEstimateMetadata {
  bitrateKbps?: number;
  bitrateBasis?: HlsManifestBitrateBasis;
  width?: number;
  height?: number;
  frameRate?: number;
  variantCount?: number;
}

interface HlsVariantEstimate extends HlsExportEstimateMetadata {
  bandwidth?: number;
  averageBandwidth?: number;
}

export async function fetchHlsExportEstimateMetadata(
  url: string,
  outputDimensions: ExportOutputDimensions | null,
  signal?: AbortSignal,
) {
  const response = await fetch(url, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    return null;
  }

  return selectHlsExportEstimateMetadata(
    parseHlsExportEstimateMetadata(await response.text()),
    outputDimensions,
  );
}

export function parseHlsExportEstimateMetadata(
  playlist: string,
): HlsVariantEstimate[] {
  const variants: HlsVariantEstimate[] = [];

  for (const line of playlist.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.toUpperCase().startsWith("#EXT-X-STREAM-INF:")) {
      continue;
    }

    const attributes = parseHlsAttributes(
      trimmed.slice(trimmed.indexOf(":") + 1),
    );
    const bandwidth = numberAttribute(attributes.get("BANDWIDTH"));
    const averageBandwidth = numberAttribute(
      attributes.get("AVERAGE-BANDWIDTH"),
    );
    const resolution = resolutionAttribute(attributes.get("RESOLUTION"));
    const frameRate = numberAttribute(attributes.get("FRAME-RATE"));
    const selectedBandwidth = averageBandwidth ?? bandwidth;
    const bitrateBasis = averageBandwidth
      ? ("average-bandwidth" as const)
      : bandwidth
        ? ("bandwidth" as const)
        : undefined;

    variants.push({
      bandwidth,
      averageBandwidth,
      bitrateBasis,
      bitrateKbps:
        selectedBandwidth === undefined
          ? undefined
          : Math.round(selectedBandwidth / 1000),
      width: resolution?.width,
      height: resolution?.height,
      frameRate,
    });
  }

  return variants;
}

export function selectHlsExportEstimateMetadata(
  variants: readonly HlsVariantEstimate[],
  outputDimensions: ExportOutputDimensions | null,
): HlsExportEstimateMetadata | null {
  if (variants.length === 0) {
    return null;
  }

  const variantsWithBitrate = variants.filter(
    (variant) => typeof variant.bitrateKbps === "number",
  );
  if (variantsWithBitrate.length === 0) {
    return null;
  }

  const selectedVariant =
    outputDimensions?.height && outputDimensions.height > 0
      ? [...variantsWithBitrate].sort(
          (left, right) =>
            Math.abs((left.height ?? 0) - outputDimensions.height) -
              Math.abs((right.height ?? 0) - outputDimensions.height) ||
            (right.bitrateKbps ?? 0) - (left.bitrateKbps ?? 0),
        )[0]
      : [...variantsWithBitrate].sort(
          (left, right) => (right.bitrateKbps ?? 0) - (left.bitrateKbps ?? 0),
        )[0];

  if (!selectedVariant) {
    return null;
  }

  return {
    bitrateKbps: selectedVariant.bitrateKbps,
    bitrateBasis: selectedVariant.bitrateBasis,
    width: selectedVariant.width,
    height: selectedVariant.height,
    frameRate: selectedVariant.frameRate,
    variantCount: variantsWithBitrate.length,
  };
}

function parseHlsAttributes(value: string) {
  const attributes = new Map<string, string>();
  const attributePattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(value))) {
    attributes.set(match[1].toUpperCase(), match[2].replace(/^"|"$/g, ""));
  }

  return attributes;
}

function numberAttribute(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resolutionAttribute(value: string | undefined) {
  const match = value?.match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return undefined;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) &&
    width > 0 &&
    Number.isFinite(height) &&
    height > 0
    ? { width, height }
    : undefined;
}
