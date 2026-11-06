import {
  Keyboard,
  MoreHorizontal,
  Redo2,
  RotateCcw,
  Undo2,
} from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { EditorFramegrabControl } from "#/components/editor/EditorControls";
import type { EditorLayoutVariant } from "#/components/editor/EditorLayout";
import type { useEditorHistory } from "#/components/editor/useEditorHistory";
import { buttonClassName } from "#/components/ui/control-styles";
import { DialogWindow } from "#/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";

const shortcuts = [
  ["Play / pause", "Space"],
  ["Set In / Out at the playhead", "I / O (or [ / ])"],
  ["Jump to In / Out", "Shift + I / O"],
  ["Seek 30 seconds", "← / →"],
  ["Seek 5 seconds", "Shift + ← / →"],
  ["Previous / next frame", "Page Up / Page Down (or hold K + J / L)"],
  ["Zoom out / in", "− / +"],
  ["Delete selected subtitle", "Delete / Backspace"],
  ["Undo", "Ctrl / ⌘ + Z"],
  ["Redo", "Ctrl / ⌘ + Shift + Z (or Ctrl + Y)"],
] as const;

export function EditorHistoryControls({
  history,
  variant,
}: {
  history: ReturnType<typeof useEditorHistory>;
  variant: EditorLayoutVariant;
}) {
  const mobile = variant === "mobile";
  const className = mobile
    ? "editor-control-focus flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground disabled:opacity-40"
    : buttonClassName({ tone: "secondary", size: "compact" });
  return (
    <>
      <button
        type="button"
        onClick={history.undo}
        disabled={!history.canUndo}
        aria-label="Undo"
        className={className}
      >
        <Undo2 className="h-4 w-4" />
        {!mobile && "Undo"}
      </button>
      <button
        type="button"
        onClick={history.redo}
        disabled={!history.canRedo}
        aria-label="Redo"
        className={className}
      >
        <Redo2 className="h-4 w-4" />
        {!mobile && "Redo"}
      </button>
    </>
  );
}

export function useEditorEditingTools({
  history,
  variant,
  onResetDraft,
  resetDisabled,
  draftNotice,
  playbackSourceControl,
  title,
  framegrab,
  menuTriggerReference,
}: {
  history: ReturnType<typeof useEditorHistory>;
  variant: EditorLayoutVariant;
  onResetDraft: () => void;
  resetDisabled: boolean;
  draftNotice: string | null;
  playbackSourceControl: ReactNode;
  title?: string;
  framegrab?: {
    onClick: () => void;
    disabledReason: string | null;
    open: boolean;
  };
  menuTriggerReference: RefObject<HTMLButtonElement | null>;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const cancelResetReference = useRef<HTMLButtonElement>(null);
  const mobile = variant === "mobile";
  const shortcutsReference = useRef<HTMLButtonElement>(null);
  const resetReference = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobile) {
      setMenuOpen(false);
    }
  }, [mobile]);
  const shortcutsButton = (
    <button
      ref={shortcutsReference}
      type="button"
      onClick={() => {
        setMenuOpen(false);
        setHelpOpen(true);
      }}
      className={`${buttonClassName({ tone: "secondary", size: "compact" })} ${mobile ? "m-3 min-h-11" : ""}`}
    >
      <Keyboard className="h-4 w-4" /> Shortcuts
    </button>
  );
  const resetButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            ref={resetReference}
            type="button"
            aria-label="Reset draft"
            disabled={resetDisabled}
            className={
              mobile
                ? `${buttonClassName({ tone: "secondary", size: "compact" })} mx-3 mb-3 min-h-11`
                : buttonClassName({ tone: "icon", size: "icon" })
            }
            onClick={() => {
              setMenuOpen(false);
              setResetOpen(true);
            }}
          >
            <RotateCcw className="h-4 w-4" />
            {mobile && "Reset draft"}
          </button>
        }
      />
      <TooltipContent>Reset draft</TooltipContent>
    </Tooltip>
  );
  const resetDescription =
    "This removes the saved clip range, crop, and subtitle edits from this device. Your original video is unchanged.";
  const resetActions = (
    <div className="flex justify-end gap-2 border-t border-border p-4">
      <button
        ref={cancelResetReference}
        type="button"
        className={`${buttonClassName({ tone: "secondary" })} ${mobile ? "min-h-11" : ""}`}
        onClick={() => setResetOpen(false)}
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={resetDisabled}
        className={`${buttonClassName()} ${mobile ? "min-h-11" : ""}`}
        onClick={() => {
          setResetOpen(false);
          onResetDraft();
        }}
      >
        Reset draft
      </button>
    </div>
  );
  const controls = (
    <div
      className={
        mobile
          ? "contents"
          : "flex shrink-0 flex-wrap items-center gap-2 border-b border-editor-border bg-editor-panel px-3 py-2"
      }
    >
      {!mobile && <EditorHistoryControls history={history} variant={variant} />}
      <span role="status" className="sr-only">
        {draftNotice}
      </span>
      {mobile ? (
        <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
          <DrawerTrigger
            render={
              <button
                ref={menuTriggerReference}
                type="button"
                aria-label="More editor options"
                className="editor-control-focus flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
              >
                <MoreHorizontal className="h-5 w-5" />
                <span>More</span>
              </button>
            }
          />
          <DrawerContent
            className="border-editor-border bg-editor-panel"
            finalFocus={() => !resetOpen && !helpOpen && !framegrab?.open}
          >
            <DrawerHeader>
              <DrawerTitle>Editor options</DrawerTitle>
              <DrawerDescription>
                View playback details, manage this device’s draft, and view
                keyboard shortcuts.
              </DrawerDescription>
            </DrawerHeader>
            {title && <p className="break-words px-3 pb-3 text-sm">{title}</p>}
            {draftNotice && (
              <p className="px-3 pb-3 text-xs text-muted-foreground">
                {draftNotice}
              </p>
            )}
            {framegrab && (
              <div className="px-3 pb-3">
                <EditorFramegrabControl
                  labelled
                  disabledReason={framegrab.disabledReason}
                  onClick={() => {
                    setMenuOpen(false);
                    framegrab.onClick();
                  }}
                />
              </div>
            )}
            {playbackSourceControl}
            {shortcutsButton}
            {resetButton}
          </DrawerContent>
        </Drawer>
      ) : (
        <div className="ml-auto flex items-center gap-2">
          {playbackSourceControl}
          {shortcutsButton}
          {resetButton}
        </div>
      )}
    </div>
  );
  const dialogs = (
    <>
      <DialogWindow
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset draft?"
        description={resetDescription}
        closeLabel="Close reset confirmation"
        initialFocus={cancelResetReference}
        finalFocus={() =>
          (mobile ? menuTriggerReference.current : resetReference.current) ??
          false
        }
      >
        {resetActions}
      </DialogWindow>
      <DialogWindow
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Editor shortcuts"
        description="Use these keys while the editor is focused. Text fields keep their own editing shortcuts."
        closeLabel="Close shortcut help"
        finalFocus={() =>
          (mobile
            ? menuTriggerReference.current
            : shortcutsReference.current) ?? false
        }
      >
        <dl className="space-y-3 overflow-y-auto p-4">
          {shortcuts.map(([action, keys]) => (
            <div
              key={action}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm"
            >
              <dt>{action}</dt>
              <dd className="font-mono text-xs text-muted-foreground">
                {keys}
              </dd>
            </div>
          ))}
        </dl>
      </DialogWindow>
    </>
  );
  return { controls, dialogs };
}
