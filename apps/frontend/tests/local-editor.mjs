import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function checkLocalEditor(browser, url, fixture) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  try {
    await context.addInitScript(() => {
      Reflect.deleteProperty(globalThis, "showSaveFilePicker");
    });
    const page = await context.newPage();
    const unexpected = [];
    const origin = new URL(url).origin;
    context.on("request", (request) => {
      const target = new URL(request.url());
      if (
        ["http:", "https:"].includes(target.protocol) &&
        (target.origin !== origin ||
          !target.pathname.startsWith("/try/") ||
          request.method() !== "GET")
      ) {
        unexpected.push(request.url());
      }
    });
    await page.goto(url);
    await page.getByText("Ready to use offline").waitFor();
    await context.setOffline(true);
    await page.reload();
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page
      .getByRole("button", { name: "Play preview", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Pause preview", exact: true })
      .click();
    const start = page.getByRole("slider", { name: "Clip start" });
    await start.press("ArrowRight");
    await start.press("ArrowRight");

    const pickSubtitle = async (name, text) => {
      await page.getByRole("button", { name: "Subtitle options" }).click();
      const chooser = page.waitForEvent("filechooser");
      await page
        .getByRole("menuitem", { name: "Import subtitle file…" })
        .click();
      const picker = await chooser;
      await picker.setFiles({ name, mimeType: "", buffer: Buffer.from(text) });
    };
    const hasCue = async (text) => {
      await page.waitForFunction(
        (expected) =>
          Object.values(localStorage).some((raw) => raw.includes(expected)),
        text,
      );
    };
    await pickSubtitle(
      "captions.SRT",
      "\uFEFF1\r\n00:00:00,300 --> 00:00:00,700\r\nSRT caption\r\n",
    );
    await hasCue("SRT caption");
    await pickSubtitle(
      "replacement.vtt",
      "WEBVTT\n\n00:00.300 --> 00:00.700\nVTT caption\n",
    );
    await page.getByRole("button", { name: "Replace cues" }).click();
    await hasCue("VTT caption");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await hasCue("SRT caption");
    await pickSubtitle("empty.vtt", "WEBVTT\n");
    await page.getByRole("button", { name: "Replace cues" }).click();
    await page.getByText("No subtitles found in this track.").waitFor();

    await page.reload();
    await page.getByRole("button", { name: "Open Video", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export MP4", exact: true }).click();
    const download = await downloading;
    const output = await readFile(await download.path());
    // The fixture has solid-color frames. White pixels identify the burned-in text.
    const pixels = await page.evaluate(
      async (bytes) => {
        const objectUrl = URL.createObjectURL(
          new Blob([Uint8Array.from(bytes)], { type: "video/mp4" }),
        );
        const video = globalThis.document.createElement("video");
        try {
          const loaded = new Promise((resolve, reject) => {
            video.addEventListener("loadedmetadata", resolve);
            video.addEventListener("error", reject, { once: true });
          });
          video.src = objectUrl;
          await loaded;
          const canvas = globalThis.document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context_ = canvas.getContext("2d", {
            willReadFrequently: true,
          });
          const counts = [];
          for (const time of [0.1, 0.5, 0.85]) {
            const seeked = new Promise((resolve) => {
              video.addEventListener("seeked", resolve, { once: true });
            });
            video.currentTime = time;
            await seeked;
            context_.drawImage(video, 0, 0);
            const data = context_.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            let white = 0;
            for (let index = 0; index < data.length; index += 4) {
              if (
                data[index] > 180 &&
                data[index + 1] > 180 &&
                data[index + 2] > 180
              ) {
                white++;
              }
            }
            counts.push(white);
          }
          return counts;
        } finally {
          video.removeAttribute("src");
          video.load();
          URL.revokeObjectURL(objectUrl);
        }
      },
      [...output],
    );
    assert.equal(pixels[0], 0);
    assert.ok(pixels[1] > 0, `Expected burned-in subtitle, got ${pixels}`);
    assert.equal(pixels[2], 0);
    assert.deepEqual(unexpected, []);
  } finally {
    await context.close();
  }
}
