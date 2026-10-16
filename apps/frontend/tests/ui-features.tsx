import { useRef, useState } from "react";

import {
  DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS,
  type EditorPropertiesOpenSections,
} from "#/components/editor/editorSidebarPreferences";
import {
  EditorSubtitlePanel,
  type EditorSubtitlePanelProperties,
} from "#/components/editor/EditorSubtitlePanel";
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
  const [sections, setSections] = useState<EditorPropertiesOpenSections>(
    DEFAULT_EDITOR_PROPERTIES_OPEN_SECTIONS,
  );
  const importTrigger = useRef<HTMLButtonElement>(null);
  const optionsTrigger = useRef<HTMLButtonElement>(null);
  const subtitles: EditorSubtitlePanelProperties["subtitles"] = {
    subtitleTracks: [],
    subtitleOutputEnabled: visible,
    setSubtitleEnabled: setVisible,
    subtitleStyleSettings: style,
    setSubtitleStyleSettings: setStyle,
    subtitleLoading: false,
    subtitleError: null,
    selectedSubtitleCue: cue,
    subtitleCues: cue ? [cue] : [],
    subtitleText: text,
    editSubtitleText: setText,
    commitText: () => setAction("Subtitle committed"),
    textError: null,
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
    canImportSubtitles: false,
    requestImport: () => {},
    cancelImport: () => {},
    subtitleTrackChangePending: false,
    requestClear: () => setAction("Clear subtitles requested"),
    clearPending: false,
  };
  return (
    <TooltipProvider>
      <section aria-label="Feature controls" className="space-y-4">
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
            subtitles={subtitles}
            subtitleTrackTriggerRef={importTrigger}
            subtitleOptionsTriggerRef={optionsTrigger}
            editorPropertiesOpenSections={sections}
            onEditorPropertiesOpenSectionsChange={setSections}
          />
        </div>
      </section>
    </TooltipProvider>
  );
}
