import { stringValue } from "../shared/utils.js";

export const PLEX_BASE_URL_MODE_AUTO = "auto";
export const PLEX_BASE_URL_MODE_MANUAL = "manual";

export type PlexBaseUrlMode =
  | typeof PLEX_BASE_URL_MODE_AUTO
  | typeof PLEX_BASE_URL_MODE_MANUAL;

export function plexBaseUrlMode(connection: Record<string, unknown>): PlexBaseUrlMode {
  return stringValue((connection as any)?.baseUrlMode) === PLEX_BASE_URL_MODE_MANUAL
    ? PLEX_BASE_URL_MODE_MANUAL
    : PLEX_BASE_URL_MODE_AUTO;
}

export function withPlexBaseUrlMode(connection: Record<string, unknown>, mode: PlexBaseUrlMode) {
  return {
    ...connection,
    baseUrlMode: mode,
  };
}
