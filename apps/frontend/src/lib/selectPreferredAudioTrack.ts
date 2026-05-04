import type { InputAudioTrack, InputVideoTrack } from "mediabunny";
import type { PlaybackAudioSelection } from "../providers/types";
import { getTrackLanguageCode, getTrackName } from "./mediabunnyTrackAccess";

function normalizedText(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

async function selectPreferredAudioTrack(
  audioTracks: readonly InputAudioTrack[],
  selectedAudioTrack?: PlaybackAudioSelection
): Promise<InputAudioTrack | null> {
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
  const tracks = await Promise.all(
    audioTracks.map(async (track) => ({
      track,
      title: normalizedText(await getTrackName(track)),
      languageCode: normalizedText(await getTrackLanguageCode(track)),
    }))
  );

  if (selectedLanguageCode && selectedTitle) {
    const exactMatch = tracks.find((track) =>
      track.languageCode === selectedLanguageCode
      && track.title === selectedTitle
    )?.track;
    if (exactMatch) {
      return exactMatch;
    }
  }

  if (selectedTitle) {
    const matchingTitleTrack = tracks.find((track) => track.title === selectedTitle)?.track;
    if (matchingTitleTrack) {
      return matchingTitleTrack;
    }
  }

  if (selectedLanguageCode) {
    const matchingLanguageTracks = tracks
      .filter((track) => track.languageCode === selectedLanguageCode)
      .map((track) => track.track);
    if (matchingLanguageTracks.length === 1) {
      return matchingLanguageTracks[0];
    }
  }

  return fallbackTrack;
}

export async function selectPreferredPairableAudioTrack(
  videoTrack: InputVideoTrack | null,
  audioTracks: readonly InputAudioTrack[],
  selectedAudioTrack?: PlaybackAudioSelection
): Promise<InputAudioTrack | null> {
  if (!videoTrack) {
    return selectPreferredAudioTrack(audioTracks, selectedAudioTrack);
  }

  const pairableAudioTracks = await videoTrack.getPairableAudioTracks();
  if (pairableAudioTracks.length === 0) {
    return selectPreferredAudioTrack(audioTracks, selectedAudioTrack);
  }

  const selectedPairableTrack = await selectPreferredAudioTrack(pairableAudioTracks, selectedAudioTrack);
  if (selectedPairableTrack) {
    return selectedPairableTrack;
  }

  return videoTrack.getPrimaryPairableAudioTrack();
}
