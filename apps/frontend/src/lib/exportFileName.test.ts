/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExportFileName,
  buildFramegrabFileName,
  defaultExportFileNameTemplates,
  getExportFileNameTemplateTokens,
  loadExportFileNameTemplates,
  saveExportFileNameTemplates,
  type ExportFileNameTemplateSettings,
} from "@/lib/exportFileName";

const legacyMovieTemplate =
  "{source_title} ({year}) - clip {clip_start} to {clip_end}";
const legacyEpisodeTemplate =
  "{show_title} - {episode_code} - {title} - clip {clip_start} to {clip_end}";

function withWindowStorage<T>(
  initialValue: string | null,
  callback: (storage: Map<string, string>) => T,
) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  if (initialValue !== null) {
    storage.set("cliparr.export.filename-templates.v1", initialValue);
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem(key: string) {
          return storage.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          storage.set(key, value);
        },
      },
    },
  });

  try {
    return callback(storage);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
}

void test("builds sanitized movie filenames from metadata templates", () => {
  const fileName = buildExportFileName({
    title: "Fallback: Title",
    sessionType: "movie",
    metadata: {
      providerId: "local",
      itemType: "movie",
      sourceTitle: "Movie / With: Bad * Characters?",
      year: 1999,
    },
    startTime: 61.2,
    endTime: 3661.6,
    format: "mp4",
    templates: defaultExportFileNameTemplates(),
  });

  assert.deepEqual(fileName, {
    baseName: "Movie With Bad Characters (1999) [01m01s-01h01m02s]",
    fullName: "Movie With Bad Characters (1999) [01m01s-01h01m02s].mp4",
    templateKind: "movie",
  });

  assert.equal(
    buildExportFileName({
      title: "Short Loop",
      sessionType: "movie",
      startTime: 0,
      endTime: 5,
      format: "gif",
      templates: defaultExportFileNameTemplates(),
    }).fullName,
    "Short Loop [00m00s-00m05s].gif",
  );
});

void test("builds episode filenames and falls back when episode numbers are absent", () => {
  const templates = {
    movie: "{source_title}",
    episode:
      "{show_title} - {episode_code} - {title} - {provider} - {format} - {unknown}",
  } satisfies ExportFileNameTemplateSettings;

  assert.deepEqual(
    buildExportFileName({
      title: "Pilot",
      sessionType: "episode",
      metadata: {
        providerId: "demo",
        itemType: "episode",
        title: "Pilot",
        showTitle: "Example Show",
        seasonNumber: 1,
        episodeNumber: 2,
      },
      startTime: 0,
      endTime: 10,
      format: "webm",
      templates,
    }),
    {
      baseName: "Example Show - S01E02 - Pilot - demo - webm -",
      fullName: "Example Show - S01E02 - Pilot - demo - webm -.webm",
      templateKind: "episode",
    },
  );

  assert.deepEqual(
    buildExportFileName({
      title: "Standalone",
      sessionType: "episode",
      metadata: {
        providerId: "demo",
        itemType: "episode",
        title: "Standalone",
        showTitle: "Example Show",
      },
      startTime: 0,
      endTime: 10,
      format: "mkv",
      templates,
    }),
    {
      baseName: "Example Show - Standalone - demo - mkv -",
      fullName: "Example Show - Standalone - demo - mkv -.mkv",
      templateKind: "episode",
    },
  );
});

void test("builds framegrab filenames with shared metadata cleanup", () => {
  assert.deepEqual(
    buildFramegrabFileName({
      title: "Fallback: Title",
      sessionType: "movie",
      metadata: {
        providerId: "local",
        itemType: "movie",
        sourceTitle: "Movie / With: Bad * Characters?",
        year: 1999,
      },
      frameTime: 61.2,
      format: "png",
    }),
    {
      baseName: "Movie With Bad Characters (1999) [01m01s]",
      fullName: "Movie With Bad Characters (1999) [01m01s].png",
      templateKind: "movie",
    },
  );

  assert.deepEqual(
    buildFramegrabFileName({
      title: "Pilot",
      sessionType: "episode",
      metadata: {
        providerId: "demo",
        itemType: "episode",
        title: "Pilot",
        showTitle: "Example Show",
        seasonNumber: 1,
        episodeNumber: 2,
      },
      frameTime: 3661.6,
      format: "jpg",
    }),
    {
      baseName: "Example Show - S01E02 - Pilot [01h01m02s]",
      fullName: "Example Show - S01E02 - Pilot [01h01m02s].jpg",
      templateKind: "episode",
    },
  );

  assert.equal(
    buildFramegrabFileName({
      title: "Still",
      sessionType: "video",
      metadata: undefined,
      frameTime: 0,
      format: "webp",
    }).fullName,
    "Still [00m00s].webp",
  );
});

void test("loads, migrates, and saves filename templates through local storage", () => {
  withWindowStorage(
    JSON.stringify({
      movie: legacyMovieTemplate,
      episode: legacyEpisodeTemplate,
    }),
    (storage) => {
      assert.deepEqual(
        loadExportFileNameTemplates(),
        defaultExportFileNameTemplates(),
      );

      const templates = {
        movie: "{title} custom",
        episode: "{show_title} custom",
      } satisfies ExportFileNameTemplateSettings;
      saveExportFileNameTemplates(templates);

      assert.deepEqual(
        JSON.parse(storage.get("cliparr.export.filename-templates.v1") ?? ""),
        templates,
      );
    },
  );
});

void test("exposes expected template tokens by media kind", () => {
  assert.deepEqual(getExportFileNameTemplateTokens("movie"), [
    "title",
    "source_title",
    "year",
    "clip_start",
    "clip_end",
    "clip_range",
    "provider",
    "provider_ids",
    "item_type",
    "format",
  ]);
  assert.ok(
    getExportFileNameTemplateTokens("episode").includes("episode_code"),
  );
  assert.ok(
    getExportFileNameTemplateTokens("episode").includes("provider_ids"),
  );
});

void test("renders provider IDs in filenames using the source convention", () => {
  const templates = {
    ...defaultExportFileNameTemplates(),
    movie: "{source_title} ({year}) {provider_ids}",
    episode: "{show_title} - {episode_code} {provider_ids}",
  };

  const plexFile = buildExportFileName({
    title: "Clip",
    sessionType: "movie",
    metadata: {
      providerId: "plex",
      itemType: "movie",
      sourceTitle: "Dune",
      year: 2021,
      externalIds: { imdb: "tt1160419", tmdb: "438631" },
    },
    startTime: 0,
    endTime: 10,
    format: "mp4",
    templates,
  });
  assert.equal(plexFile.baseName, "Dune (2021) {tmdb-438631}");

  const jellyfinEpisode = buildExportFileName({
    title: "Clip",
    sessionType: "episode",
    metadata: {
      providerId: "jellyfin",
      itemType: "episode",
      showTitle: "Severance",
      seasonNumber: 1,
      episodeNumber: 2,
      externalIds: { tvdb: "12345" },
    },
    startTime: 0,
    endTime: 10,
    format: "mkv",
    templates,
  });
  // Episode GUIDs are episode-level, but the filename conventions expect
  // series-level IDs, so the token stays empty for episodes.
  assert.equal(jellyfinEpisode.baseName, "Severance - S01E02");

  const withoutIds = buildExportFileName({
    title: "Clip",
    sessionType: "movie",
    metadata: {
      providerId: "plex",
      itemType: "movie",
      sourceTitle: "Dune",
      year: 2021,
    },
    startTime: 0,
    endTime: 10,
    format: "mp4",
    templates,
  });
  assert.equal(withoutIds.baseName, "Dune (2021)");
});

void test("restricts filename provider IDs to movies for both providers", () => {
  const templates = {
    ...defaultExportFileNameTemplates(),
    movie: "{title} {provider_ids}",
    episode: "{title} {provider_ids}",
  };
  for (const providerId of ["plex", "jellyfin"]) {
    for (const itemType of ["episode", "Episode", "video", "track"]) {
      const file = buildExportFileName({
        title: "Clip",
        sessionType: "movie",
        metadata: {
          providerId,
          itemType,
          externalIds: { imdb: "tt123", tmdb: "456", tvdb: "789" },
        },
        startTime: 0,
        endTime: 10,
        format: "mp4",
        templates,
      });
      assert.equal(file.baseName, "Clip");
    }
  }
  const movie = buildExportFileName({
    title: "Clip",
    sessionType: "movie",
    metadata: {
      providerId: "jellyfin",
      itemType: "Movie",
      externalIds: { tmdb: "456" },
    },
    startTime: 0,
    endTime: 10,
    format: "mp4",
    templates,
  });
  assert.equal(movie.baseName, "Clip [tmdbid-456]");
});
