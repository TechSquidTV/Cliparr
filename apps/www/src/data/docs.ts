export const docsSectionIds = [
  "install-operate",
  "sources",
  "editing-export",
  "contributing",
] as const;

export type DocsSectionId = (typeof docsSectionIds)[number];

export const docsSections: {
  id: DocsSectionId;
  title: string;
  description: string;
}[] = [
  {
    id: "install-operate",
    title: "Install & operate",
    description:
      "Run Cliparr, keep it persistent, and decide how it should be exposed.",
  },
  {
    id: "sources",
    title: "Sources",
    description:
      "Connect media servers or open videos directly in the browser.",
  },
  {
    id: "editing-export",
    title: "Editing & export",
    description:
      "Choose clip ranges, output settings, subtitles, metadata, and shortcuts.",
  },
  {
    id: "contributing",
    title: "Contributing",
    description: "Set up the workspace and prepare changes for review.",
  },
];

function sortDocs<T extends { data: { order: number } }>(docs: T[]) {
  return [...docs].sort((a, b) => a.data.order - b.data.order);
}

export function docsForSection<
  T extends { data: { order: number; section: DocsSectionId } },
>(docs: T[], sectionId: DocsSectionId) {
  return sortDocs(docs.filter((entry) => entry.data.section === sectionId));
}
