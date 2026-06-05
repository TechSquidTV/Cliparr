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

export function numberValue(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return;
  }

  return Math.trunc(number);
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
