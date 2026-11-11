import {
  fromSeconds,
  TimelineEngine,
  TimelineProvider,
} from "@techsquidtv/canvas-timeline";
import { useRef, useState } from "react";

import { DashboardMobileMenu } from "#/components/dashboard/DashboardMobileMenu";
import { EDITOR_DESKTOP_LAYOUT_QUERY } from "#/components/editor/editorLayoutSizing";
import {
  EditorSubtitlePanel,
  type EditorSubtitlePanelProperties,
  type EditorSubtitleTab,
} from "#/components/editor/EditorSubtitlePanel";
import { EditorTimeline } from "#/components/editor/EditorTimeline";
import { SourceCard } from "#/components/sources/SourceCard";
import { TooltipProvider } from "#/components/ui/tooltip";
import { loadSubtitleStyleSettings } from "#/lib/subtitles/settings";
import type { SubtitleCue } from "#/lib/subtitles/types";

export function FeatureControls() {
  const [action, setAction] = useState("");
  const [sourceName, setSourceName] = useState("Example server");
  const [draftName, setDraftName] = useState(sourceName);
  const [draftUrl, setDraftUrl] = useState("https://media.example.test");
  const [enabled, setEnabled] = useState(true);
  const [text, setText] = useState("Example subtitle");
  const [visible, setVisible] = useState(true);
  const [style, setStyle] = useState(loadSubtitleStyleSettings);
  const [cue, setCue] = useState<SubtitleCue | null>({
    id: "cue",
    startTime: 1,
    endTime: 3,
    text,
    lines: [text],
  });
  const [tab, setTab] = useState<EditorSubtitleTab>("text");
  const optionsTrigger = useRef<HTMLButtonElement>(null);
  const subtitles: EditorSubtitlePanelProperties["subtitles"] = {
    subtitleTracks: [
      {
        streamId: "2",
        index: 2,
        languageCode: "eng",
        title: "English",
        codec: "subrip",
        isText: true,
        contentUrl: "/api/media/example",
      },
    ],
    unavailableSubtitleTracks: [
      {
        track: {
          streamId: "3",
          index: 3,
          languageCode: "eng",
          title: "English (Blu-ray)",
          codec: "pgssub",
          isText: false,
          isForced: true,
        },
        reason:
          "Image-based subtitles cannot be imported. Only text tracks are supported.",
      },
      {
        track: {
          streamId: "4",
          index: 4,
          languageCode: "spa",
          codec: "ass",
          isText: true,
        },
        reason: "Select this embedded subtitle in Plex first.",
      },
    ],
    subtitleOutputEnabled: visible,
    setSubtitleEnabled: setVisible,
    subtitleStyleSettings: style,
    setSubtitleStyleSettings: setStyle,
    subtitleLoading: false,
    selectedSubtitleCue: cue,
    subtitleCues: cue ? [cue] : [],
    subtitleText: text,
    editSubtitleText: setText,
    commitText: () => setAction("Subtitle committed"),
    beginTextComposition: () => {},
    endTextComposition: () => {},
    selectedSubtitleOutsideRange: false,
    canAddSubtitle: true,
    addSubtitle: () => setAction("Add subtitle requested"),
    focusRevision: 0,
    handleSelectedSubtitleStartCommit: (startTime) => {
      setCue((current) => (current ? { ...current, startTime } : null));
      setAction("Subtitle in point changed");
    },
    handleSelectedSubtitleEndCommit: (endTime) => {
      setCue((current) => (current ? { ...current, endTime } : null));
    },
    handleDeleteSelectedSubtitle: () => {
      setCue(null);
      setAction("Subtitle deleted");
    },
    handleSelectPreviousSubtitle: () => {},
    handleSelectNextSubtitle: () => {},
    handleSeekToSelectedSubtitle: () => setAction("Subtitle seek requested"),
    canImportSubtitles: true,
    requestImport: () => setAction("Subtitle import requested"),
    subtitleTrackChangePending: false,
    requestClear: () => setAction("Clear subtitles requested"),
    clearPending: false,
  };
  return (
    <TooltipProvider>
      <section aria-label="Feature controls" className="space-y-4">
        {new URLSearchParams(window.location.search).has("timeline") && (
          <TimelineControls />
        )}
        <DashboardMobileMenu
          appVersion="1.2.3"
          latestRelease={null}
          onDisconnect={() => setAction("Disconnected")}
        />
        <output aria-label="Last test action">{action}</output>
        <SourceCard
          source={{
            id: "source",
            name: sourceName,
            providerId: "plex",
            baseUrl: "https://media.example.test",
            enabled,
            metadata: {},
            lastCheckedAt: null,
            lastError: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          }}
          draftName={draftName}
          draftBaseUrl={draftUrl}
          refreshingAll={false}
          onDraftNameChange={setDraftName}
          onDraftBaseUrlChange={setDraftUrl}
          onSave={() => {
            setSourceName(draftName);
            setAction("Source saved");
          }}
          onToggleEnabled={() => {
            setEnabled((current) => !current);
            setAction("Source toggled");
          }}
          onRefresh={() => setAction("Source refresh requested")}
          onRemove={() => setAction("Source removal requested")}
        />
        <div className="h-[38rem] max-w-sm">
          <EditorSubtitlePanel
            variant={
              globalThis.matchMedia(EDITOR_DESKTOP_LAYOUT_QUERY).matches
                ? "desktop"
                : "mobile"
            }
            subtitles={subtitles}
            subtitleOptionsTriggerRef={optionsTrigger}
            tab={tab}
            onTabChange={setTab}
            consumeFocus={() => false}
          />
        </div>
      </section>
    </TooltipProvider>
  );
}

function TimelineControls() {
  const [trackNamesVisible, setTrackNamesVisible] = useState(true);
  const [engine] = useState(
    () =>
      new TimelineEngine({
        duration: fromSeconds(120),
        zoomScale: 74,
        tracks: [],
      }),
  );
  return (
    <TimelineProvider engine={engine}>
      <button onClick={() => setTrackNamesVisible(!trackNamesVisible)}>
        Toggle timeline track names
      </button>
      <div className="isolate h-48">
        <EditorTimeline
          engine={engine}
          variant="mobile"
          trackNamesVisible={trackNamesVisible}
          muted={false}
          onMutedChange={() => {}}
          canAddSubtitle={false}
          onAddSubtitle={() => {}}
          onOpenSubtitles={() => {}}
          subtitleLoading={false}
          onInteractionStart={() => {}}
        />
      </div>
    </TimelineProvider>
  );
}
