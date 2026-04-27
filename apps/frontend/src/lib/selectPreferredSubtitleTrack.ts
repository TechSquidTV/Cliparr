import type { PlaybackSubtitleSelection, PlaybackSubtitleTrack } from "../providers/types";

function normalizedText(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

export function subtitleTrackKey(track: Pick<PlaybackSubtitleTrack, "streamId" | "index">) {
  if (track.streamId) {
    return `stream:${track.streamId}`;
  }

  if (track.index !== undefined) {
    return `index:${track.index}`;
  }

  return "unknown";
}

export function subtitleTrackSupportsBurnIn(track: PlaybackSubtitleTrack | null | undefined) {
  return Boolean(track?.isText && track?.contentUrl);
}

export function subtitleTrackUnavailableMessage(
  track: PlaybackSubtitleTrack | null | undefined,
  providerId?: string
) {
  if (!track || subtitleTrackSupportsBurnIn(track)) {
    return undefined;
  }

  if (track.isText && providerId === "plex") {
    return "Plex detected this text subtitle track, but it does not expose it as a downloadable subtitle stream for styled burn-in yet.";
  }

  if (track.isText) {
    return "This text subtitle track is available, but the provider does not expose it as a downloadable subtitle stream for styled burn-in.";
  }

  return "This subtitle track exists, but it is not yet supported for styled burn-in.";
}

export function selectPreferredSubtitleTrack(
  subtitleTracks: readonly PlaybackSubtitleTrack[],
  selectedSubtitleTrack?: PlaybackSubtitleSelection
) {
  const fallbackTrack = subtitleTracks.find((track) => subtitleTrackSupportsBurnIn(track))
    ?? subtitleTracks.find((track) => track.isDefault)
    ?? subtitleTracks[0]
    ?? null;

  if (!selectedSubtitleTrack) {
    return fallbackTrack;
  }

  if (selectedSubtitleTrack.streamId) {
    const matchingStream = subtitleTracks.find((track) => track.streamId === selectedSubtitleTrack.streamId);
    if (matchingStream) {
      return matchingStream;
    }
  }

  if (selectedSubtitleTrack.index !== undefined) {
    const matchingIndex = subtitleTracks.find((track) => track.index === selectedSubtitleTrack.index);
    if (matchingIndex) {
      return matchingIndex;
    }
  }

  const selectedLanguageCode = normalizedText(selectedSubtitleTrack.languageCode);
  const selectedTitle = normalizedText(selectedSubtitleTrack.title);

  if (selectedLanguageCode && selectedTitle) {
    const exactMatch = subtitleTracks.find((track) =>
      normalizedText(track.languageCode) === selectedLanguageCode
      && normalizedText(track.title) === selectedTitle
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  if (selectedTitle) {
    const matchingTitle = subtitleTracks.find((track) => normalizedText(track.title) === selectedTitle);
    if (matchingTitle) {
      return matchingTitle;
    }
  }

  if (selectedLanguageCode) {
    const singleLanguageMatch = subtitleTracks.filter(
      (track) => normalizedText(track.languageCode) === selectedLanguageCode
    );
    if (singleLanguageMatch.length === 1) {
      return singleLanguageMatch[0] ?? fallbackTrack;
    }
  }

  return fallbackTrack;
}
