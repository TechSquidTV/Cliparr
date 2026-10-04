import type { ExternalIds } from "@cliparr/shared/external-ids";

/**
Native external-ID projections for exported files.

Capability matrix (verified against the mediabunny 1.61.0 muxer sources,
not just its docs):

- MP4/MOV/M4A: no native ID tags. The ISOBMFF muxer only writes
  4-character raw atom keys in the default mdir and udta paths; longer keys
  (including Apple freeform `----:com.apple.iTunes:*` atoms) are
  silently dropped. IDs live in the `clpr` JSON payload only.
- MKV/WebM: IMDB/TMDB/TVDB SimpleTags. The Matroska muxer turns every
  raw string key into a SimpleTag with no name restriction.
- MP3: TXXX:IMDB / TXXX:TMDB / TXXX:TVDB. Mediabunny has no ID3 UFID
  frame writer, so the Picard-style UFID projection is not available;
  the TXXX description record is the working mechanism.
- OGG/FLAC: IMDB/TMDB/TVDB Vorbis comments. Arbitrary raw keys become
  `KEY=value` comments.
- WAV: Cliparr explicitly writes an ID3 chunk to preserve Unicode and
  cover art. No native ID projection is used; IDs stay in the
  `TXXX:CLIPARR_METADATA` JSON payload.

In every format the `clpr`/`CLIPARR_METADATA` JSON payload is
the source of truth. These native projections are a convenience for
tag readers; they never carry anything the payload lacks.
*/

function externalIdEntries(ids: ExternalIds | undefined) {
  const entries: Array<[string, string]> = [];
  if (ids?.imdb) {
    entries.push(["IMDB", ids.imdb]);
  }
  if (ids?.tmdb) {
    entries.push(["TMDB", ids.tmdb]);
  }
  if (ids?.tvdb) {
    entries.push(["TVDB", ids.tvdb]);
  }
  return entries;
}

/**
External ID keys shared by Matroska SimpleTags, Vorbis comments, and
MP3 ID3 TXXX descriptions. The caller places them in the appropriate container.
*/
export function buildKeyValueExternalIdTags(
  ids: ExternalIds | undefined,
): Record<string, string> {
  return Object.fromEntries(externalIdEntries(ids));
}

/**
Formats the preferred external ID for the `{provider_ids}` filename
template token, using the filename convention of the source provider
(Plex `{imdb-tt...}` / Jellyfin `[tmdbid-...]`). TMDB is preferred,
then TVDB, then IMDb: numeric IDs are unambiguous in filenames and
TMDB covers both movies and series. Returns undefined when there is
no ID or no known provider convention so the token renders empty.
*/
export function formatProviderIdForFilename(
  ids: ExternalIds | undefined,
  providerId: string | undefined,
): string | undefined {
  if (!ids || (providerId !== "plex" && providerId !== "jellyfin")) {
    return undefined;
  }
  for (const scheme of ["tmdb", "tvdb", "imdb"] as const) {
    const id = ids[scheme];
    if (id) {
      return providerId === "plex"
        ? `{${scheme}-${id}}`
        : `[${scheme}id-${id}]`;
    }
  }
  return undefined;
}
