import { ChevronLeft, ChevronRight, LocateFixed, Trash2 } from "lucide-react";
import { type RefObject } from "react";

import { EditorEditableTimecode } from "#/components/editor/EditorEditableTimecode";
import {
  EditorPropertyRow,
  EditorPropertySection,
} from "#/components/editor/EditorPropertyControls";
import type { EditorSubtitlePanelProperties } from "#/components/editor/EditorSubtitlePanel";
import { formatTimecodeInput } from "#/components/editor/editorUtilities";
import { editorIconButtonClassName } from "#/components/ui/control-styles";

export function EditorSubtitleCueEditor({
  subtitles,
  textReference,
}: {
  subtitles: EditorSubtitlePanelProperties["subtitles"];
  textReference: RefObject<HTMLTextAreaElement | null>;
}) {
  const {
    subtitleLoading,
    selectedSubtitleCue,
    subtitleText,
    editSubtitleText,
    commitText,
    textError,
    selectedSubtitleOutsideRange,
    subtitleCues,
    handleSelectedSubtitleStartCommit: onSelectedSubtitleStartCommit,
    handleSelectedSubtitleEndCommit: onSelectedSubtitleEndCommit,
    handleDeleteSelectedSubtitle: onDeleteSelectedSubtitle,
    handleSelectPreviousSubtitle: onSelectPreviousSubtitle,
    handleSelectNextSubtitle: onSelectNextSubtitle,
    handleSeekToSelectedSubtitle: onSeekToSelectedSubtitle,
  } = subtitles;
  return (
    <fieldset disabled={subtitleLoading} className="min-w-0">
      <EditorPropertySection
        title="Selected subtitle"
        action={
          selectedSubtitleCue ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onSelectPreviousSubtitle}
                aria-label="Select previous subtitle cue"
                className={editorIconButtonClassName({
                  size: "sm",
                  variant: "ghost",
                  className: "h-11 w-11 lg:h-7 lg:w-7",
                })}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onSelectNextSubtitle}
                aria-label="Select next subtitle cue"
                className={editorIconButtonClassName({
                  size: "sm",
                  variant: "ghost",
                  className: "h-11 w-11 lg:h-7 lg:w-7",
                })}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onSeekToSelectedSubtitle}
                aria-label="Seek to selected subtitle"
                className={editorIconButtonClassName({
                  size: "sm",
                  variant: "ghost",
                  className: "h-11 w-11 lg:h-7 lg:w-7",
                })}
              >
                <LocateFixed className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onDeleteSelectedSubtitle}
                aria-label="Delete subtitle"
                className="editor-control-focus inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15 lg:h-7 lg:w-7"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null
        }
      >
        {selectedSubtitleCue ? (
          <>
            <EditorPropertyRow label="Text" align="start">
              <textarea
                aria-label="Subtitle text"
                ref={textReference}
                disabled={subtitleLoading}
                value={subtitleText}
                rows={4}
                onChange={(event) => editSubtitleText(event.target.value)}
                onBlur={commitText}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    commitText();
                  }
                }}
                className="editor-control-focus w-full resize-y rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2.5 py-2 text-xs leading-relaxed text-foreground outline-none focus-visible:border-editor-accent"
              />
            </EditorPropertyRow>
            {textError && (
              <p role="status" className="px-3 text-xs text-destructive">
                {textError}
              </p>
            )}
            {selectedSubtitleOutsideRange && (
              <p className="px-3 text-xs text-muted-foreground">
                Outside export range
              </p>
            )}
            <EditorPropertyRow label="In">
              <EditorEditableTimecode
                ariaLabel="subtitle cue in point"
                value={selectedSubtitleCue.startTime}
                onCommit={onSelectedSubtitleStartCommit}
                className="w-full justify-end"
                buttonClassName="w-full justify-end rounded-[var(--radius-control)] px-2 py-1 font-mono text-xs text-foreground hover:bg-editor-control-hover"
              >
                <span>
                  {formatTimecodeInput(selectedSubtitleCue.startTime)}
                </span>
              </EditorEditableTimecode>
            </EditorPropertyRow>
            <EditorPropertyRow label="Out">
              <EditorEditableTimecode
                ariaLabel="subtitle cue out point"
                value={selectedSubtitleCue.endTime}
                onCommit={onSelectedSubtitleEndCommit}
                className="w-full justify-end"
                buttonClassName="w-full justify-end rounded-[var(--radius-control)] px-2 py-1 font-mono text-xs text-foreground hover:bg-editor-control-hover"
              >
                <span>{formatTimecodeInput(selectedSubtitleCue.endTime)}</span>
              </EditorEditableTimecode>
            </EditorPropertyRow>
            <EditorPropertyRow
              label="Duration"
              value={formatTimecodeInput(
                selectedSubtitleCue.endTime - selectedSubtitleCue.startTime,
              )}
            >
              {null}
            </EditorPropertyRow>
          </>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {subtitleCues.length === 0
              ? "Add your own text at the playhead, or import subtitles."
              : "Select a subtitle in the timeline to edit its text and timing."}
          </p>
        )}
      </EditorPropertySection>
    </fieldset>
  );
}
