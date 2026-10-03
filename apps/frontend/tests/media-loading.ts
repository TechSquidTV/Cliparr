import type { ExportClipOptions } from "#/lib/exportClip";

async function buildLoadingFixtures() {
  const { createMediaLoadingFixtures } =
    await import("#/lib/mediaLoadingFixtures.test-support");
  return createMediaLoadingFixtures();
}

async function exportLoadingFixture({
  fixture,
  format,
  mode,
}: Pick<ExportClipOptions, "format" | "mode"> & { fixture: string }) {
  const { exportClip } = await import("#/convert");
  const response = await fetch(`/fixtures/${fixture}`);
  if (!response.ok) {
    throw new Error("Could not load export fixture");
  }
  const file = new File([await response.blob()], fixture);
  const blob = await exportClip({
    mediaSource: {
      kind: "file",
      role: "local-file",
      label: fixture,
      file,
      fileName: fixture,
    },
    format,
    mode,
    resolution: "original",
    startTime: 0,
    endTime: 0.5,
    onProgress: () => {},
  });
  return { size: blob.size, type: blob.type };
}

declare global {
  var createLoadingFixtures: typeof buildLoadingFixtures;
  var runLoadingExport: typeof exportLoadingFixture;
}
globalThis.createLoadingFixtures = buildLoadingFixtures;
globalThis.runLoadingExport = exportLoadingFixture;
