import type { ExportFormat } from "#/lib/export/exportTypes";

/** Request the destination during the click handler, before loading the encoder. */
export async function chooseExportFile(fileName: string, format: ExportFormat) {
  const browserWindow = globalThis.window as
    | (Window & {
        showSaveFilePicker?: (options: {
          suggestedName: string;
        }) => Promise<FileSystemFileHandle>;
      })
    | undefined;
  // GIF uses its dedicated frame encoder rather than a Mediabunny output target.
  if (format === "gif" || !browserWindow?.showSaveFilePicker) {
    return { status: "download" as const };
  }
  try {
    const handle = await browserWindow.showSaveFilePicker({
      suggestedName: fileName,
    });
    return { status: "selected" as const, handle };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "cancelled" as const };
    }
    throw error;
  }
}
