/** External media database identifiers parsed from provider GUID URIs (`scheme://id`, plus legacy Plex agent URIs). */
export interface ExternalIds {
  /** IMDb identifier, e.g. `tt0133093`. */
  imdb?: string;
  /** TMDB numeric identifier. */
  tmdb?: string;
  /** TVDB numeric identifier. */
  tvdb?: string;
}

const imdbIdPattern = /^tt\d+$/;
const numericIdPattern = /^\d+$/;

function splitGuid(value: string): { scheme: string; id: string } | undefined {
  const separator = value.indexOf("://");
  if (separator <= 0) {
    return undefined;
  }
  // `com.plexapp.agents.imdb` -> `imdb`; `imdb` -> `imdb`.
  const schemePart = value.slice(0, separator);
  const scheme = schemePart
    .toLowerCase()
    .replace(/^com\.plexapp\.agents\./u, "");
  const id = value
    .slice(separator + 3)
    .split("?", 1)[0]
    ?.trim();
  if (!scheme || !id) {
    return undefined;
  }
  return { scheme, id };
}

/** Extract known external IDs from provider GUID URIs; first valid ID wins per scheme, undefined when none found. */
export function parseExternalIds(
  guids: readonly string[] | undefined,
): ExternalIds | undefined {
  const ids: ExternalIds = {};
  for (const guid of guids ?? []) {
    if (typeof guid !== "string") {
      continue;
    }
    const parsed = splitGuid(guid.trim());
    if (!parsed) {
      continue;
    }
    const { scheme, id } = parsed;
    switch (scheme) {
      case "imdb": {
        if (ids.imdb === undefined && imdbIdPattern.test(id)) {
          ids.imdb = id;
        }
        break;
      }
      case "tmdb": {
        if (ids.tmdb === undefined && numericIdPattern.test(id)) {
          ids.tmdb = id;
        }
        break;
      }
      case "tvdb": {
        if (ids.tvdb === undefined && numericIdPattern.test(id)) {
          ids.tvdb = id;
        }
        break;
      }
      default: {
        break;
      }
    }
  }
  return (ids.imdb ?? ids.tmdb ?? ids.tvdb) ? ids : undefined;
}
