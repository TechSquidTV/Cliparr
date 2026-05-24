import { useEffect, useState } from "react";
import {
  createSubtitleFontOptionFromValue,
  loadLocalSubtitleFontOptions,
  SUBTITLE_FONT_OPTIONS,
  type SubtitleFontOption,
} from "../../lib/subtitles/settings";

interface UseSubtitleFontOptionsResult {
  currentFontOption: SubtitleFontOption | null;
  bundledFontOptions: readonly SubtitleFontOption[];
  localFontOptions: readonly SubtitleFontOption[];
  loadingLocalFonts: boolean;
  requestLocalFonts: () => void;
}

export function useSubtitleFontOptions(
  selectedFontFamily: string
): UseSubtitleFontOptionsResult {
  const [localFontOptions, setLocalFontOptions] = useState<readonly SubtitleFontOption[]>([]);
  const [localFontsRequested, setLocalFontsRequested] = useState(false);
  const [loadingLocalFonts, setLoadingLocalFonts] = useState(false);

  useEffect(() => {
    if (!localFontsRequested) {
      return;
    }

    let cancelled = false;

    setLoadingLocalFonts(true);

    void loadLocalSubtitleFontOptions()
      .then((options) => {
        if (!cancelled) {
          setLocalFontOptions(options);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingLocalFonts(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [localFontsRequested]);

  const currentFontOption = createSubtitleFontOptionFromValue(selectedFontFamily, [
    ...SUBTITLE_FONT_OPTIONS,
    ...localFontOptions,
  ]);

  return {
    currentFontOption,
    bundledFontOptions: SUBTITLE_FONT_OPTIONS,
    localFontOptions,
    loadingLocalFonts,
    requestLocalFonts: () => setLocalFontsRequested(true),
  };
}
