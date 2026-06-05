import { useEffect, useRef } from "react";
import {
  resolveEditorShortcutCommand,
  type EditorShortcutCommand,
} from "@/components/editor/editorShortcutCommands";

interface UseEditorKeyboardShortcutsProperties {
  togglePlay: () => void;
  markIn?: () => void;
  markOut?: () => void;
  jumpToIn?: () => void;
  jumpToOut?: () => void;
  seekBackwardLarge?: () => void;
  seekForwardLarge?: () => void;
  seekBackwardSmall?: () => void;
  seekForwardSmall?: () => void;
  stepFrameBackward?: () => void;
  stepFrameForward?: () => void;
  zoomOut?: () => void;
  zoomIn?: () => void;
}

export function useEditorKeyboardShortcuts({
  togglePlay,
  markIn,
  markOut,
  jumpToIn,
  jumpToOut,
  seekBackwardLarge,
  seekForwardLarge,
  seekBackwardSmall,
  seekForwardSmall,
  stepFrameBackward,
  stepFrameForward,
  zoomOut,
  zoomIn,
}: UseEditorKeyboardShortcutsProperties) {
  const commandHandlersReference = useRef<
    Partial<Record<EditorShortcutCommand, () => void>>
  >({});

  useEffect(() => {
    commandHandlersReference.current = {
      "toggle-play": togglePlay,
      "mark-in": markIn,
      "mark-out": markOut,
      "jump-to-in": jumpToIn,
      "jump-to-out": jumpToOut,
      "seek-backward-large": seekBackwardLarge,
      "seek-forward-large": seekForwardLarge,
      "seek-backward-small": seekBackwardSmall,
      "seek-forward-small": seekForwardSmall,
      "step-frame-backward": stepFrameBackward,
      "step-frame-forward": stepFrameForward,
      "zoom-out": zoomOut,
      "zoom-in": zoomIn,
    };
  });

  useEffect(() => {
    const pressedCodes = new Set<string>();

    function handleKeyDown(event: KeyboardEvent) {
      if (isInteractiveKeyboardTarget(event.target) || isModalDialogOpen()) {
        return;
      }

      pressedCodes.add(event.code);
      const command = resolveEditorShortcutCommand({
        code: event.code,
        repeat: event.repeat,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        pressedCodes,
      });
      const handler = command
        ? commandHandlersReference.current[command]
        : undefined;

      if (!handler) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      handler();
    }

    function handleKeyUp(event: KeyboardEvent) {
      pressedCodes.delete(event.code);
    }

    function handleBlur() {
      pressedCodes.clear();
    }

    globalThis.addEventListener("keydown", handleKeyDown);
    globalThis.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
      globalThis.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);
}

function isInteractiveKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      'input, textarea, select, button, [contenteditable="true"], [role="slider"], [role="dialog"], [role="alertdialog"], dialog',
    ),
  );
}

function isModalDialogOpen() {
  if (typeof document === "undefined") {
    return false;
  }

  return Boolean(
    document.querySelector(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog[open]',
    ),
  );
}
