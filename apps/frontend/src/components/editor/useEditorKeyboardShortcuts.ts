import { useEffect } from "react";

interface UseEditorKeyboardShortcutsProps {
  togglePlay: () => void;
}

export function useEditorKeyboardShortcuts({ togglePlay }: UseEditorKeyboardShortcutsProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space") {
        return;
      }

      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (isInteractiveKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
      togglePlay();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [togglePlay]);
}

function isInteractiveKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest("input, textarea, select, button, [contenteditable=\"true\"], [role=\"slider\"]"),
  );
}
