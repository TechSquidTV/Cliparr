import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@cliparr/plex/pms/client";
import {
  getIdentity,
  libraryGetSections,
  libraryPostSection,
} from "@cliparr/plex/pms";
import type { LibraryPostSectionData } from "@cliparr/plex/pms/types";

export async function bootstrapPlex(options: {
  baseUrl: string;
  library: LibraryPostSectionData["query"];
  token?: string;
  fetch?: typeof fetch;
  attempts?: number;
  intervalMs?: number;
}) {
  const client = createClient({
    baseUrl: options.baseUrl,
    headers: {
      Accept: "application/json",
      ...(options.token ? { "X-Plex-Token": options.token } : {}),
    },
    fetch: options.fetch,
    redirect: "error",
  });
  let failure: unknown;
  for (let attempt = 0; attempt < (options.attempts ?? 90); attempt += 1) {
    try {
      await getIdentity({
        client,
        signal: AbortSignal.timeout(5000),
        throwOnError: true,
      });
      const { data } = await libraryGetSections({
        client,
        signal: AbortSignal.timeout(5000),
        throwOnError: true,
      });
      const sections = data.MediaContainer;
      if (!sections) {
        throw new Error("Plex did not return library sections");
      }
      if (
        sections.Directory?.some(
          (section) => section.title === options.library.name,
        )
      ) {
        return "exists";
      }
      await libraryPostSection({
        client,
        query: options.library,
        signal: AbortSignal.timeout(5000),
        throwOnError: true,
      });
      return "created";
    } catch (error) {
      failure = error;
    }
    if (attempt + 1 < (options.attempts ?? 90)) {
      await delay(options.intervalMs ?? 2000);
    }
  }
  throw new Error(
    "Plex library bootstrap did not complete within the readiness limit",
    { cause: failure },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await bootstrapPlex({
      baseUrl: process.env.PLEX_BASE_URL ?? "http://plex:32400",
      token: process.env.PLEX_TOKEN,
      library: {
        name: process.env.PLEX_LIBRARY_NAME ?? "Movies",
        location: process.env.PLEX_LIBRARY_PATH ?? "/data/movies",
        language: process.env.PLEX_LIBRARY_LANGUAGE ?? "en-US",
        type: process.env.PLEX_LIBRARY_TYPE ?? "movie",
        agent: process.env.PLEX_LIBRARY_AGENT ?? "tv.plex.agents.movie",
        scanner: process.env.PLEX_LIBRARY_SCANNER ?? "Plex Movie",
      },
    });
    process.stdout.write(`Plex library ${result}.\n`);
  } catch {
    process.stderr.write(
      "Plex bootstrap failed. Check server readiness and library permissions.\n",
    );
    process.exitCode = 1;
  }
}
