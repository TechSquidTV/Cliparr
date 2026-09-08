import { useState } from "react";
import { Keyboard, Redo2, Undo2 } from "lucide-react";
import { DialogWindow } from "@/components/ui/dialog";
import { compactSecondaryButtonClasses } from "@/components/ui/control-styles";
import type { useEditorHistory } from "@/components/editor/useEditorHistory";

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
}: {
  history: ReturnType<typeof useEditorHistory>;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-editor-border bg-editor-panel px-3 py-2">
      <button
        type="button"
        onClick={history.undo}
        disabled={!history.canUndo}
        className={compactSecondaryButtonClasses}
      >
        <Undo2 className="h-4 w-4" /> Undo
      </button>
      <button
        type="button"
        onClick={history.redo}
        disabled={!history.canRedo}
        className={compactSecondaryButtonClasses}
      >
        <Redo2 className="h-4 w-4" /> Redo
      </button>
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        className={`${compactSecondaryButtonClasses} ml-auto`}
      >
        <Keyboard className="h-4 w-4" /> Shortcuts
      </button>
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
