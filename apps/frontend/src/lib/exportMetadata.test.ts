/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { MetadataTags } from "mediabunny";
import { buildMetadataTags, patchMp4MetadataBoxes } from "@/lib/exportMetadata";

const byteMask = 255;

function bytes(...values: number[]) {
  return new Uint8Array(values);
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function uint32(value: number) {
  return bytes(
    (value >>> 24) & byteMask,
    (value >>> 16) & byteMask,
    (value >>> 8) & byteMask,
    value & byteMask,
  );
}

function concatBytes(...chunks: Uint8Array[]) {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function box(type: string, content: Uint8Array) {
  return concatBytes(uint32(content.length + 8), textBytes(type), content);
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 2 ** 24 +
    bytes[offset + 1] * 2 ** 16 +
    bytes[offset + 2] * 2 ** 8 +
    bytes[offset + 3]
  );
}

async function withMockedFetch<T>(
  handler: (
    ...arguments_: Parameters<typeof fetch>
  ) => ReturnType<typeof fetch>,
  action: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;

  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withWindowLocation<T>(href: string, callback: () => Promise<T>) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href,
      },
    },
  });

  try {
    return await callback();
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
}

function findText(bytes: Uint8Array, text: string, start = 0) {
  const needle = textBytes(text);

  for (let index = start; index <= bytes.length - needle.length; index += 1) {
    if (needle.every((value, offset) => bytes[index + offset] === value)) {
      return index;
    }
  }

  return -1;
}

void test("builds MP4 metadata tags for movie clips", async () => {
  const tags = await buildMetadataTags(
    {
      providerId: "demo",
      itemType: "movie",
      title: "Movie Clip",
      sourceTitle: "Original Movie",
      year: 2001,
      description: "A useful scene",
      genres: ["Action", "Drama"],
      contentRating: "PG-13",
    },
    65.125,
    130.75,
    1080,
    "mp4",
  );

  assert.ok(tags);
  assert.equal(tags.title, "Movie Clip");
  assert.equal(tags.description, "A useful scene");
  assert.equal(tags.genre, "Action, Drama");
  assert.equal(tags.date instanceof Date, true);
  assert.equal((tags.date as Date).getUTCFullYear(), 2001);
  assert.equal(
    tags.comment,
    "Clip from Original Movie, 1:05 to 2:11. Content rating: PG-13.",
  );

  const raw = tags.raw as NonNullable<MetadataTags["raw"]>;
  assert.deepEqual(raw.stik, bytes(9));
  assert.deepEqual(raw.hdvd, bytes(1));
  assert.equal(raw["©TIM"], "00:01:05.125");
  assert.equal(raw.csta, "65.125");
  assert.equal(raw.cend, "130.750");
  assert.equal(raw.cdur, "65.625");
  assert.deepEqual(JSON.parse(raw.clpr as string), {
    sourceStartSeconds: 65.125,
    sourceEndSeconds: 130.75,
    sourceDurationSeconds: 65.625,
  });
});

void test("builds episode metadata and embeds fetched artwork", async () => {
  await withMockedFetch(
    async (input) => {
      assert.equal(input, "/artwork/cover");
      return new Response(bytes(1, 2, 3), {
        status: 200,
        headers: {
          "content-type": "image/png; charset=binary",
        },
      });
    },
    async () => {
      const tags = await buildMetadataTags(
        {
          providerId: "demo",
          itemType: "episode",
          title: "Episode Title",
          showTitle: "Great Show",
          seasonNumber: 3,
          episodeNumber: 7,
          network: "Example Network",
          directors: ["A Director", "B Director"],
          tagline: "A tiny line",
          imageUrl: "/artwork/cover",
        },
        0,
        10,
        480,
        "mov",
      );

      assert.ok(tags);
      assert.equal(tags.title, "Episode Title");
      assert.equal(tags.description, "A tiny line");
      assert.equal(tags.images?.[0]?.mimeType, "image/png");
      assert.deepEqual(tags.images?.[0]?.data, bytes(1, 2, 3));

      const raw = tags.raw as NonNullable<MetadataTags["raw"]>;
      assert.deepEqual(raw.stik, bytes(10));
      assert.deepEqual(raw.hdvd, bytes(0));
      assert.equal(raw.tvsh, "Great Show");
      assert.deepEqual(raw.tvsn, uint32(3));
      assert.deepEqual(raw.tves, uint32(7));
      assert.equal(raw.tven, "S03E07");
      assert.equal(raw.tvnn, "Example Network");
      assert.equal(raw["©dir"], "A Director, B Director");
    },
  );
});

void test("omits raw ISOBMFF metadata for non-MP4-like formats", async () => {
  const tags = await buildMetadataTags(
    {
      providerId: "demo",
      itemType: "movie",
      title: "Movie Clip",
    },
    0,
    10,
    1080,
    "webm",
  );

  assert.ok(tags);
  assert.equal(tags.raw, undefined);
});

void test("infers artwork mime type and ignores failed artwork fetches", async () => {
  await withWindowLocation("http://cliparr.test/dashboard", async () => {
    await withMockedFetch(
      async (input) => {
        if (input === "https://cdn.example.test/poster.webp") {
          return new Response(bytes(4, 5), { status: 200 });
        }

        return new Response("not found", { status: 404 });
      },
      async () => {
        const withArtwork = await buildMetadataTags(
          {
            providerId: "demo",
            itemType: "movie",
            title: "Movie Clip",
            imageUrl: "https://cdn.example.test/poster.webp",
          },
          0,
          10,
          1080,
          "mp4",
        );
        assert.equal(withArtwork?.images?.[0]?.mimeType, "image/webp");

        const withoutArtwork = await buildMetadataTags(
          {
            providerId: "demo",
            itemType: "movie",
            title: "Movie Clip",
            imageUrl: "https://cdn.example.test/missing.jpg",
          },
          0,
          10,
          1080,
          "mp4",
        );
        assert.equal(withoutArtwork?.images, undefined);
      },
    );
  });
});

void test("patches MP4 ilst integer metadata data types", () => {
  const stikData = box("data", concatBytes(uint32(0), bytes(0, 0, 0, 0, 10)));
  const tvsnData = box(
    "data",
    concatBytes(uint32(0), bytes(0, 0, 0, 0, 0, 0, 0, 3)),
  );
  const ilst = box(
    "ilst",
    concatBytes(box("stik", stikData), box("tvsn", tvsnData)),
  );
  const meta = box("meta", concatBytes(bytes(0, 0, 0, 0), ilst));
  const file = box("moov", box("udta", meta));

  patchMp4MetadataBoxes(file);

  const stikTypeOffset = findText(file, "stik");
  const stikDataTypeOffset = findText(file, "data", stikTypeOffset) + 4;
  const tvsnTypeOffset = findText(file, "tvsn");
  const tvsnDataTypeOffset = findText(file, "data", tvsnTypeOffset) + 4;

  assert.ok(stikTypeOffset >= 0);
  assert.ok(tvsnTypeOffset >= 0);
  assert.equal(readUint32(file, stikDataTypeOffset), 0x15);
  assert.equal(readUint32(file, tvsnDataTypeOffset), 0x16);
});
