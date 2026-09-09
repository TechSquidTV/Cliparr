import { useRef, useState } from "react";
import {
  Keyboard,
  MoreHorizontal,
  Redo2,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { DialogWindow } from "@/components/ui/dialog";
import {
  compactSecondaryButtonClasses,
  iconButtonClasses,
  primaryButtonClasses,
  secondaryButtonClasses,
} from "@/components/ui/control-styles";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { useEditorHistory } from "@/components/editor/useEditorHistory";
import type { EditorLayoutVariant } from "@/components/editor/EditorLayout";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

const shortcuts = [
  ["Play / pause", "Space"],
  ["Set In / Out at the playhead", "I / O (or [ / ])"],
  ["Jump to In / Out", "Shift + I / O"],
  ["Seek 30 seconds", "← / →"],
  ["Seek 5 seconds", "Shift + ← / →"],
  ["Previous / next frame", "Page Up / Page Down (or hold K + J / L)"],
  ["Zoom out / in", "− / +"],
  ["Undo", "Ctrl / ⌘ + Z"],
  ["Redo", "Ctrl / ⌘ + Shift + Z (or Ctrl + Y)"],
] as const;

export function EditorEditingTools({
  history,
  variant,
  onResetDraft,
  resetDisabled,
  draftNotice,
}: {
  history: ReturnType<typeof useEditorHistory>;
  variant: EditorLayoutVariant;
  onResetDraft: () => void;
  resetDisabled: boolean;
  draftNotice: string | null;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const cancelResetReference = useRef<HTMLButtonElement>(null);
  const menuTriggerReference = useRef<HTMLButtonElement>(null);
  const mobile = variant === "mobile";
  const historyButtonClassName = `${compactSecondaryButtonClasses} ${mobile ? "min-h-11 w-11 p-0" : ""}`;
  const shortcutsButton = (
    <button
      type="button"
      onClick={() => {
        setMenuOpen(false);
        setHelpOpen(true);
      }}
      className={`${compactSecondaryButtonClasses} ${mobile ? "m-3 min-h-11" : "ml-auto"}`}
    >
      <Keyboard className="h-4 w-4" /> Shortcuts
    </button>
  );
  const resetButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Reset draft"
          disabled={resetDisabled}
          className={
            mobile
              ? `${compactSecondaryButtonClasses} mx-3 mb-3 min-h-11`
              : `${iconButtonClasses} disabled:cursor-not-allowed disabled:opacity-60`
          }
          onClick={() => {
            setMenuOpen(false);
            setResetOpen(true);
          }}
        >
          <RotateCcw className="h-4 w-4" />
          {mobile && "Reset draft"}
        </button>
      </TooltipTrigger>
      <TooltipContent>Reset draft</TooltipContent>
    </Tooltip>
  );
  const resetDescription =
    "This removes the saved clip range and subtitle edits from this device. Your original video is unchanged.";
  const resetActions = (
    <div className="flex justify-end gap-2 border-t border-border p-4">
      <button
        ref={cancelResetReference}
        type="button"
        className={`${secondaryButtonClasses} ${mobile ? "min-h-11" : ""}`}
        onClick={() => setResetOpen(false)}
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={resetDisabled}
        className={`${primaryButtonClasses} ${mobile ? "min-h-11" : ""}`}
        onClick={() => {
          setResetOpen(false);
          onResetDraft();
        }}
      >
        Reset draft
      </button>
    </div>
  );
  return (
    <div
      className={`flex flex-wrap items-center gap-2 border-b border-editor-border bg-editor-panel px-3 ${mobile ? "py-1" : "py-2"}`}
    >
      <button
        type="button"
        onClick={history.undo}
        disabled={!history.canUndo}
        aria-label="Undo"
        className={historyButtonClassName}
      >
        <Undo2 className="h-4 w-4" /> {!mobile && "Undo"}
      </button>
      <button
        type="button"
        onClick={history.redo}
        disabled={!history.canRedo}
        aria-label="Redo"
        className={historyButtonClassName}
      >
        <Redo2 className="h-4 w-4" /> {!mobile && "Redo"}
      </button>
      <span role="status" className="sr-only">
        {draftNotice}
      </span>
      {mobile ? (
        <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
          <DrawerTrigger asChild>
            <button
              ref={menuTriggerReference}
              type="button"
              aria-label="More editor options"
              className={`${historyButtonClassName} ml-auto`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DrawerTrigger>
          <DrawerContent className="border-editor-border bg-editor-panel">
            <DrawerHeader>
              <DrawerTitle>Editor options</DrawerTitle>
              <DrawerDescription>
                Manage this device’s draft and view keyboard shortcuts.
              </DrawerDescription>
            </DrawerHeader>
            {shortcutsButton}
            {resetButton}
          </DrawerContent>
        </Drawer>
      ) : (
        <>
          {shortcutsButton}
          {resetButton}
        </>
      )}
      {mobile ? (
        <Drawer open={resetOpen} onOpenChange={setResetOpen}>
          <DrawerContent
            className="border-editor-border bg-editor-panel"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelResetReference.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              menuTriggerReference.current?.focus();
            }}
          >
            <DrawerHeader>
              <DrawerTitle>Reset draft?</DrawerTitle>
              <DrawerDescription>{resetDescription}</DrawerDescription>
            </DrawerHeader>
            {resetActions}
          </DrawerContent>
        </Drawer>
      ) : (
        <DialogWindow
          open={resetOpen}
          onClose={() => setResetOpen(false)}
          title="Reset draft?"
          description={resetDescription}
          closeLabel="Close reset confirmation"
          initialFocus={cancelResetReference}
        >
          {resetActions}
        </DialogWindow>
      )}
      <DialogWindow
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Editor shortcuts"
        description="Use these keys while the editor is focused. Text fields keep their own editing shortcuts."
        closeLabel="Close shortcut help"
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
    </div>
  );
}
