import { createApiError } from "@/http/errors";

interface EpisodeSourceTitleInput {
  title?: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  return [value];
}

export function stringValue(value: unknown) {
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

export function booleanEnv(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

export function numberValue(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return;
  }

  return Math.trunc(number);
}

/** Normalize provider ratings to 0-10, preserving fractions to one decimal place. */
export function normalizeRating(
  value: number | string | null | undefined,
  sourceScale: 10 | 100 = 10,
): number | undefined {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  ) {
    return undefined;
  }
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0 || rating > sourceScale) {
    return undefined;
  }
  // Jellyfin's CriticRating is a 0-100 Rotten Tomatoes-style percentage
  // (CommunityRating is the 0-10 field), so always scale it to 0-10.
  const normalized = sourceScale === 100 ? rating / 10 : rating;
  return Math.round(normalized * 10) / 10;
}

export function uniqueStrings(values: Iterable<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function formatEpisodeCode(seasonNumber?: number, episodeNumber?: number) {
  const season =
    seasonNumber === undefined
      ? undefined
      : `S${String(seasonNumber).padStart(2, "0")}`;
  const episode =
    episodeNumber === undefined
      ? undefined
      : `E${String(episodeNumber).padStart(2, "0")}`;

  if (season && episode) {
    return `${season}${episode}`;
  }

  return season ?? episode;
}

export function buildEpisodeSourceTitle(input: EpisodeSourceTitleInput) {
  const episodeCode = formatEpisodeCode(
    input.seasonNumber,
    input.episodeNumber,
  );
  return (
    uniqueStrings([input.seriesTitle, episodeCode, input.title]).join(" - ") ||
    input.title
  );
}

export function assertHttpUrl(uri: string, providerName: string) {
  const parsed = new URL(uri);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createApiError(
      400,
      "invalid_connection_url",
      `${providerName} connection must use HTTP or HTTPS`,
    );
  }

  return parsed;
}
