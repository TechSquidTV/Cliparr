import type {
  CurrentlyPlayingEntry,
  ViewerPlaybackGroup,
} from "@/providers/types";

function compareStrings(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

export function groupCurrentPlayback(
  entries: CurrentlyPlayingEntry[],
): ViewerPlaybackGroup[] {
  const groups = new Map<string, ViewerPlaybackGroup>();

  for (const entry of entries) {
    const existingGroup = groups.get(entry.viewer.id);
    if (existingGroup) {
      existingGroup.items.push(entry.item);
      continue;
    }

    groups.set(entry.viewer.id, {
      viewer: entry.viewer,
      items: [entry.item],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items.toSorted(
        (left, right) =>
          compareStrings(left.source.name, right.source.name) ||
          compareStrings(left.playerTitle, right.playerTitle) ||
          compareStrings(left.title, right.title) ||
          compareStrings(left.id, right.id),
      ),
    }))
    .toSorted(
      (left, right) =>
        compareStrings(left.viewer.name, right.viewer.name) ||
        compareStrings(left.viewer.id, right.viewer.id),
    );
}
