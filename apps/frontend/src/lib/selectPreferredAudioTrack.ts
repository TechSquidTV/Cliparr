import type { InputAudioTrack } from "mediabunny";
import type { PlaybackAudioSelection } from "../providers/types";

function normalizedText(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

export function selectPreferredAudioTrack(
  audioTracks: readonly InputAudioTrack[],
  selectedAudioTrack?: PlaybackAudioSelection
): InputAudioTrack | null {
  const fallbackTrack: InputAudioTrack | null = audioTracks[0] ?? null;
  if (!selectedAudioTrack) {
    return fallbackTrack;
  }

  if (selectedAudioTrack.trackNumber !== undefined) {
    const matchingTrack = audioTracks.find((track) => track.number === selectedAudioTrack.trackNumber);
    if (matchingTrack) {
      return matchingTrack;
    }
  }

  const selectedLanguageCode = normalizedText(selectedAudioTrack.languageCode);
  const selectedTitle = normalizedText(selectedAudioTrack.title);

  if (selectedLanguageCode && selectedTitle) {
    const exactMatch = audioTracks.find((track) =>
      normalizedText(track.languageCode) === selectedLanguageCode
      && normalizedText(track.name) === selectedTitle
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  if (selectedTitle) {
    const matchingTitleTrack = audioTracks.find((track) => normalizedText(track.name) === selectedTitle);
    if (matchingTitleTrack) {
      return matchingTitleTrack;
    }
  }

  if (selectedLanguageCode) {
    const matchingLanguageTracks = audioTracks.filter((track) =>
      normalizedText(track.languageCode) === selectedLanguageCode
    );
    if (matchingLanguageTracks.length === 1) {
      return matchingLanguageTracks[0];
    }
  }

  return fallbackTrack;
}
