export const EDITOR_PROPERTIES_SECTION_ID = {
  selection: "selection",
  globalSubtitles: "global-subtitles",
} as const;

const EDITOR_PROPERTIES_SECTION_IDS = [
  EDITOR_PROPERTIES_SECTION_ID.selection,
  EDITOR_PROPERTIES_SECTION_ID.globalSubtitles,
] as const;

export type EditorPropertiesSectionId =
  (typeof EDITOR_PROPERTIES_SECTION_IDS)[number];

export type EditorPropertiesOpenSections = readonly EditorPropertiesSectionId[];

export const DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS = [
  EDITOR_PROPERTIES_SECTION_ID.selection,
  EDITOR_PROPERTIES_SECTION_ID.globalSubtitles,
] as const satisfies EditorPropertiesOpenSections;

const EDITOR_PROPERTIES_ACCORDION_STORAGE_KEY =
  "cliparr.editor.properties.accordion.v1";

interface EditorPropertiesAccordionPreferences {
  openSections: EditorPropertiesOpenSections;
}

const editorPropertiesSectionIdSet = new Set<string>(
  EDITOR_PROPERTIES_SECTION_IDS,
);

function defaultEditorPropertiesOpenSections(): EditorPropertiesOpenSections {
  return [...DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEditorPropertiesSectionId(
  value: unknown,
): value is EditorPropertiesSectionId {
  return typeof value === "string" && editorPropertiesSectionIdSet.has(value);
}

function normalizeEditorPropertiesOpenSections(
  value: unknown,
): EditorPropertiesOpenSections | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const openSections: EditorPropertiesSectionId[] = [];
  for (const sectionId of value) {
    if (
      isEditorPropertiesSectionId(sectionId) &&
      !openSections.includes(sectionId)
    ) {
      openSections.push(sectionId);
    }
  }

  return openSections;
}

export function loadEditorPropertiesOpenSections(): EditorPropertiesOpenSections {
  if (globalThis.window === undefined) {
    return defaultEditorPropertiesOpenSections();
  }

  try {
    const raw = globalThis.localStorage.getItem(
      EDITOR_PROPERTIES_ACCORDION_STORAGE_KEY,
    );
    if (!raw) {
      return defaultEditorPropertiesOpenSections();
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return defaultEditorPropertiesOpenSections();
    }

    return (
      normalizeEditorPropertiesOpenSections(parsed.openSections) ??
      defaultEditorPropertiesOpenSections()
    );
  } catch {
    return defaultEditorPropertiesOpenSections();
  }
}

export function saveEditorPropertiesOpenSections(
  openSections: EditorPropertiesOpenSections,
) {
  if (globalThis.window === undefined) {
    return;
  }

  try {
    const preferences = {
      openSections:
        normalizeEditorPropertiesOpenSections(openSections) ??
        defaultEditorPropertiesOpenSections(),
    } satisfies EditorPropertiesAccordionPreferences;

    globalThis.localStorage.setItem(
      EDITOR_PROPERTIES_ACCORDION_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // Best-effort persistence only.
  }
}
