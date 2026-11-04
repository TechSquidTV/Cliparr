/* global document, requestAnimationFrame */
import type { Page } from "playwright";

export const cropGuideImageName = "video-cropping.png";

export async function waitForLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

/** Capture the real editor's crop controls with a predictable portrait selection. */
export async function captureCropGuide(page: Page, destination: string) {
  const tool = page.getByRole("button", { name: "Crop video", exact: true });
  if ((await tool.getAttribute("aria-pressed")) !== "true") {
    await tool.click();
  }
  await page.getByRole("button", { name: "Remove crop", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Aspect ratio", exact: true })
    .click();
  await page.getByRole("option", { name: "9:16", exact: true }).click();
  await page.getByRole("listbox").waitFor({ state: "detached" });
  await page.locator("cropper-canvas").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const region = document
      .querySelector("cropper-selection")
      ?.getBoundingClientRect();
    return (
      region &&
      region.height > 0 &&
      Math.abs(region.width / region.height - 9 / 16) < 0.001
    );
  });
  await waitForLayout(page);
  await page.screenshot({ path: destination });
}
