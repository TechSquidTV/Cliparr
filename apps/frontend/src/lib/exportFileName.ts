import type { MediaExportMetadata } from "../providers/types";
import type { ExportFormat } from "./exportClip";

export type ExportFileNameTemplateKind = "movie" | "episode";

export interface ExportFileNameTemplateSettings {
  movie: string;
  episode: string;
}

interface BuildExportFileNameOptions {
  title: string;
  sessionType?: string;
  metadata?: MediaExportMetadata;
  startTime: number;
  endTime: number;
  format: ExportFormat;
  templates: ExportFileNameTemplateSettings;
}

const EXPORT_FILE_NAME_TEMPLATE_STORAGE_KEY = "cliparr.export.filename-templates.v1";

const LEGACY_DEFAULT_MOVIE_EXPORT_FILE_NAME_TEMPLATE = "{source_title} ({year}) - clip {clip_start} to {clip_end}";
const LEGACY_DEFAULT_EPISODE_EXPORT_FILE_NAME_TEMPLATE = "{show_title} - {episode_code} - {title} - clip {clip_start} to {clip_end}";

const DEFAULT_MOVIE_EXPORT_FILE_NAME_TEMPLATE = "{source_title} ({year}) [{clip_start}-{clip_end}]";
const DEFAULT_EPISODE_EXPORT_FILE_NAME_TEMPLATE = "{show_title} - {episode_code} - {title} [{clip_start}-{clip_end}]";

type ExportFileNameTemplateToken =
  | "title"
  | "source_title"
  | "show_title"
  | "season_title"
  | "season_number"
  | "episode_number"
  | "episode_code"
  | "year"
  | "clip_start"
  | "clip_end"
  | "clip_range"
  | "provider"
  | "item_type"
  | "format";

const MOVIE_EXPORT_FILE_NAME_TEMPLATE_TOKENS: readonly ExportFileNameTemplateToken[] = [
  "title",
  "source_title",
  "year",
  "clip_start",
  "clip_end",
  "clip_range",
  "provider",
  "item_type",
  "format",
];

const EPISODE_EXPORT_FILE_NAME_TEMPLATE_TOKENS: readonly ExportFileNameTemplateToken[] = [
  "title",
  "source_title",
  "show_title",
  "season_title",
  "season_number",
  "episode_number",
  "episode_code",
  "year",
  "clip_start",
  "clip_end",
  "clip_range",
  "provider",
  "item_type",
  "format",
];

export function defaultExportFileNameTemplates(): ExportFileNameTemplateSettings {
  return {
    movie: DEFAULT_MOVIE_EXPORT_FILE_NAME_TEMPLATE,
    episode: DEFAULT_EPISODE_EXPORT_FILE_NAME_TEMPLATE,
  };
}

export function getExportFileNameTemplateTokens(kind: ExportFileNameTemplateKind) {
  return kind === "episode"
    ? EPISODE_EXPORT_FILE_NAME_TEMPLATE_TOKENS
    : MOVIE_EXPORT_FILE_NAME_TEMPLATE_TOKENS;
}

function migrateStoredTemplate(
  storedTemplate: string | undefined,
  defaultTemplate: string,
  legacyDefaultTemplate: string
) {
  if (typeof storedTemplate !== "string" || !storedTemplate.trim()) {
    return defaultTemplate;
  }

  return storedTemplate === legacyDefaultTemplate ? defaultTemplate : storedTemplate;
}

export function loadExportFileNameTemplates(): ExportFileNameTemplateSettings {
  const defaults = defaultExportFileNameTemplates();

  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(EXPORT_FILE_NAME_TEMPLATE_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as Partial<ExportFileNameTemplateSettings>;

    return {
      movie: migrateStoredTemplate(parsed.movie, defaults.movie, LEGACY_DEFAULT_MOVIE_EXPORT_FILE_NAME_TEMPLATE),
      episode: migrateStoredTemplate(parsed.episode, defaults.episode, LEGACY_DEFAULT_EPISODE_EXPORT_FILE_NAME_TEMPLATE),
    };
  } catch {
    return defaults;
  }
}

export function saveExportFileNameTemplates(templates: ExportFileNameTemplateSettings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(EXPORT_FILE_NAME_TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // Best-effort persistence only.
  }
}

function resolveExportFileNameTemplateKind(
  sessionType: string | undefined,
  metadata: MediaExportMetadata | undefined
): ExportFileNameTemplateKind {
  const normalizedType = firstText(metadata?.itemType, sessionType)?.toLowerCase();
  return normalizedType === "episode" ? "episode" : "movie";
}

export function buildExportFileName({
  title,
  sessionType,
  metadata,
  startTime,
  endTime,
  format,
  templates,
}: BuildExportFileNameOptions) {
  const templateKind = resolveExportFileNameTemplateKind(sessionType, metadata);
  const template = templates[templateKind].trim() || defaultExportFileNameTemplates()[templateKind];
  const values = templateValues({
    title,
    sessionType,
    metadata,
    startTime,
    endTime,
    format,
  });
  const resolved = template.replace(/\{([a-z_]+)\}/gi, (_, token: string) => {
    const normalizedToken = token.toLowerCase() as ExportFileNameTemplateToken;
    const replacement = Object.hasOwn(values, normalizedToken) ? values[normalizedToken] : "";

    return replacement ?? "";
  });

  const baseName = sanitizeFileName(cleanupResolvedTemplate(resolved)) || "cliparr export";

  return {
    baseName,
    fullName: `${baseName}.${format}`,
    templateKind,
  };
}

function templateValues({
  title,
  sessionType,
  metadata,
  startTime,
  endTime,
  format,
}: Omit<BuildExportFileNameOptions, "templates">): Record<ExportFileNameTemplateToken, string> {
  const seasonNumber = nonNegativeInteger(metadata?.seasonNumber);
  const episodeNumber = nonNegativeInteger(metadata?.episodeNumber);
  const itemType = firstText(metadata?.itemType, sessionType)?.toLowerCase() ?? "video";

  return {
    title: sanitizeTemplateValue(firstText(metadata?.title, title, "Clip")),
    source_title: sanitizeTemplateValue(firstText(metadata?.sourceTitle, metadata?.title, title, "Clip")),
    show_title: sanitizeTemplateValue(firstText(metadata?.showTitle, metadata?.sourceTitle, metadata?.title, title, "Clip")),
    season_title: sanitizeTemplateValue(firstText(metadata?.seasonTitle)),
    season_number: seasonNumber === undefined ? "" : String(seasonNumber).padStart(2, "0"),
    episode_number: episodeNumber === undefined ? "" : String(episodeNumber).padStart(2, "0"),
    episode_code: sanitizeTemplateValue(formatEpisodeCode(seasonNumber, episodeNumber) ?? "Episode"),
    year: metadata?.year === undefined ? "" : String(metadata.year),
    clip_start: formatTemplateTime(startTime),
    clip_end: formatTemplateTime(endTime),
    clip_range: `${formatTemplateTime(startTime)} to ${formatTemplateTime(endTime)}`,
    provider: sanitizeTemplateValue(firstText(metadata?.providerId)),
    item_type: sanitizeTemplateValue(itemType),
    format: sanitizeTemplateValue(format),
  };
}

function firstText(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

function nonNegativeInteger(value: number | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function formatEpisodeCode(seasonNumber?: number, episodeNumber?: number) {
  const season = seasonNumber === undefined ? undefined : `S${String(seasonNumber).padStart(2, "0")}`;
  const episode = episodeNumber === undefined ? undefined : `E${String(episodeNumber).padStart(2, "0")}`;

  if (season && episode) {
    return `${season}${episode}`;
  }

  return season ?? episode;
}

function formatTemplateTime(seconds: number) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  const hoursText = hours > 0 ? `${String(hours).padStart(2, "0")}h` : "";
  return `${hoursText}${String(minutes).padStart(2, "0")}m${String(remainingSeconds).padStart(2, "0")}s`;
}

function sanitizeTemplateValue(value: string | undefined) {
  return stripControlCharacters(value ?? "")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupResolvedTemplate(value: string) {
  return value
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\{\s*\}/g, "")
    .replace(/\s+-\s+Episode\s+-\s+/g, " - ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\)/g, ")")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\]/g, "]")
    .replace(/\[\s+/g, "[")
    .trim();
}

function sanitizeFileName(value: string) {
  return stripControlCharacters(value)
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
}

function stripControlCharacters(value: string) {
  return Array.from(value).filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 32;
  }).join("");
}
