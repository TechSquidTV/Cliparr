import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { ExportClipOptions } from "#/lib/exportClip";
import type { ExportFormat, ExportMode } from "#/lib/exportFormats";
import type { EditorFileMediaSource } from "#/lib/editorMedia";

async function buildLoadingFixtures() {
  const { createMediaLoadingFixtures } =
    await import("#/lib/mediaLoadingFixtures.test-support");
  return createMediaLoadingFixtures();
}

async function loadConverterModule() {
  const { exportClip, useExportAudioPlan } = await import("#/convert");
  return { exportClip, useExportAudioPlan };
}
let converter: Awaited<ReturnType<typeof loadConverterModule>> | undefined;
async function importConverter() {
  converter = await loadConverterModule();
}

async function fixtureSource(fixture: string): Promise<EditorFileMediaSource> {
  const response = await fetch(`/fixtures/${fixture}`);
  if (!response.ok) {
    throw new Error("Could not load export fixture");
  }
  return {
    kind: "file",
    role: "local-file",
    label: fixture,
    file: new File([await response.blob()], fixture),
    fileName: fixture,
  };
}

async function mountAudioPlan(format: ExportFormat, mode: ExportMode) {
  if (!converter) {
    throw new Error("Import the converter before planning");
  }
  const { useExportAudioPlan } = converter;
  const source = await fixtureSource("aac.mp4");
  function LoadingPlan() {
    const plan = useExportAudioPlan(
      source,
      undefined,
      format,
      true,
      mode !== "video-only" && format !== "gif",
    );
    return createElement(
      "output",
      { id: "audio-plan", title: plan.disabledReason ?? "" },
      plan.status,
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  createRoot(container).render(createElement(LoadingPlan));
}

async function exportLoadingFixture({
  fixture,
  format,
  mode,
}: Pick<ExportClipOptions, "format" | "mode"> & { fixture: string }) {
  if (!converter) {
    throw new Error("Import the converter before exporting");
  }
  const blob = await converter.exportClip({
    mediaSource: await fixtureSource(fixture),
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
  var loadLoadingConverter: typeof importConverter;
  var startLoadingPlan: typeof mountAudioPlan;
  var runLoadingExport: typeof exportLoadingFixture;
}
globalThis.createLoadingFixtures = buildLoadingFixtures;
globalThis.loadLoadingConverter = importConverter;
globalThis.startLoadingPlan = mountAudioPlan;
globalThis.runLoadingExport = exportLoadingFixture;
