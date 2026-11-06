import { ChevronLeft, ChevronRight, LocateFixed, Trash2 } from "lucide-react";
import { type RefObject } from "react";

import { EditorEditableTimecode } from "#/components/editor/EditorEditableTimecode";
import { EditorPropertyRow } from "#/components/editor/EditorPropertyControls";
import type { EditorSubtitlePanelProperties } from "#/components/editor/EditorSubtitlePanel";
import { formatTimecodeInput } from "#/components/editor/editorUtilities";
import { editorIconButtonClassName } from "#/components/ui/control-styles";
import { cn } from "#/lib/cn";

export function EditorSubtitleCueEditor({
  subtitles,
  textReference,
  section,
}: {
  subtitles: EditorSubtitlePanelProperties["subtitles"];
  textReference: RefObject<HTMLTextAreaElement | null>;
  section: "text" | "timing" | "all";
}) {
  const {
    subtitleLoading,
    selectedSubtitleCue,
    subtitleText,
    editSubtitleText,
    commitText,
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
    <fieldset
      disabled={subtitleLoading}
      className={cn(
        "flex min-h-0 min-w-0 flex-col gap-2 p-2 lg:p-3",
        section === "text" && "h-full",
      )}
    >
      {selectedSubtitleCue ? (
        <>
          {section !== "timing" && (
            <label
              className={cn(
                "flex min-h-0 flex-col gap-2",
                section === "text" && "flex-1",
              )}
            >
              {section === "all" && (
                <span className="text-ui-micro text-muted-foreground">
                  Text
                </span>
              )}
              <textarea
                aria-label="Subtitle text"
                ref={textReference}
                disabled={subtitleLoading}
                value={subtitleText}
                rows={3}
                onChange={(event) => editSubtitleText(event.target.value)}
                onBlur={commitText}
                onCompositionStart={(event) => {
                  event.currentTarget.dataset.editorComposing = "true";
                  subtitles.beginTextComposition();
                }}
                onCompositionEnd={(event) => {
                  delete event.currentTarget.dataset.editorComposing;
                  editSubtitleText(event.currentTarget.value);
                  subtitles.endTextComposition();
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) {
                    return;
                  }
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    commitText();
                  }
                }}
                className={cn(
                  "editor-control-focus w-full rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2.5 py-2 text-editor-input lg:text-sm leading-relaxed text-foreground outline-none focus-visible:border-editor-accent",
                  section === "text"
                    ? "min-h-16 flex-1 resize-none"
                    : "min-h-24 resize-y",
                )}
              />
            </label>
          )}
          {selectedSubtitleOutsideRange && (
            <p className="shrink-0 text-xs text-muted-foreground">
              Outside export range
            </p>
          )}
          {section !== "text" && (
            <>
              <EditorPropertyRow label="In">
                <EditorEditableTimecode
                  ariaLabel="subtitle cue in point"
                  tool="subtitles"
                  value={selectedSubtitleCue.startTime}
                  onCommit={onSelectedSubtitleStartCommit}
                  className="w-full justify-end"
                  buttonClassName="w-full justify-end rounded-[var(--radius-control)] px-2 py-1 font-mono text-editor-property text-foreground hover:bg-editor-control-hover lg:text-xs"
                >
                  <span>
                    {formatTimecodeInput(selectedSubtitleCue.startTime)}
                  </span>
                </EditorEditableTimecode>
              </EditorPropertyRow>
              <EditorPropertyRow label="Out">
                <EditorEditableTimecode
                  ariaLabel="subtitle cue out point"
                  tool="subtitles"
                  value={selectedSubtitleCue.endTime}
                  onCommit={onSelectedSubtitleEndCommit}
                  className="w-full justify-end"
                  buttonClassName="w-full justify-end rounded-[var(--radius-control)] px-2 py-1 font-mono text-editor-property text-foreground hover:bg-editor-control-hover lg:text-xs"
                >
                  <span>
                    {formatTimecodeInput(selectedSubtitleCue.endTime)}
                  </span>
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
          )}
        </>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {subtitleCues.length === 0
            ? "Add your own text at the playhead, or import subtitles."
            : "Select a subtitle in the timeline to edit its text and timing."}
        </p>
      )}
      {selectedSubtitleCue ? (
        <div className="flex shrink-0 items-center gap-1">
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
            className="editor-control-focus ml-auto inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15 lg:h-7 lg:w-7"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </fieldset>
  );
}
