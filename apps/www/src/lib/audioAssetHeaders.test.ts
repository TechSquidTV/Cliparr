import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import audioAssetHeaders from "@/lib/audioAssetHeaders";

void test("audio build headers derive byte lengths from emitted MP3s and preserve existing rules", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "cliparr-audio-headers-"),
  );
  try {
    await mkdir(path.join(directory, "audio", "nested"), { recursive: true });
    await writeFile(
      path.join(directory, "_headers"),
      "/*\n  X-Content-Type-Options: nosniff\n",
    );
    await writeFile(
      path.join(directory, "audio", "episode.mp3"),
      new Uint8Array(10),
    );
    await writeFile(
      path.join(directory, "audio", "nested", "episode two.mp3"),
      new Uint8Array(25),
    );
    await writeFile(path.join(directory, "audio", "notes.txt"), "not audio");
    await audioAssetHeaders().hooks["astro:build:done"]({
      dir: pathToFileURL(`${directory}${path.sep}`),
    });
    const headers = await readFile(path.join(directory, "_headers"), "utf8");
    assert.equal(
      headers,
      "/*\n  X-Content-Type-Options: nosniff\n\n/audio/episode.mp3\n  Content-Length: 10\n\n/audio/nested/episode%20two.mp3\n  Content-Length: 25\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
