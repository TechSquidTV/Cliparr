import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import type { EditorTool } from "@/components/editor/EditorLayout";

interface TimecodeDraft {
  id: string;
  value: string;
  tool: EditorTool | null;
}

function useTimecodeDraft() {
  const [draft, setDraft] = useState<TimecodeDraft | null>(null);
  const current = useRef(draft);
  const update = useCallback((next: TimecodeDraft | null) => {
    current.current = next;
    setDraft(next);
  }, []);
  const finish = useCallback(
    (id: string) => {
      if (current.current?.id !== id) {
        return false;
      }
      update(null);
      return true;
    },
    [update],
  );
  return useMemo(() => ({ draft, update, finish }), [draft, update, finish]);
}

const TimecodeEditContext = createContext<ReturnType<
  typeof useTimecodeDraft
> | null>(null);

export function EditorTimecodeProvider({ children }: { children: ReactNode }) {
  const edit = useTimecodeDraft();
  return <TimecodeEditContext value={edit}>{children}</TimecodeEditContext>;
}

export function useEditorTimecodeEdit() {
  const edit = useContext(TimecodeEditContext);
  if (!edit) {
    throw new Error("Timecode controls require an editor timecode provider.");
  }
  return edit;
}

/** Finish the one active time field before changing its containing UI. */
export function completeEditorTimecode(root: HTMLElement) {
  const input = root.querySelector<HTMLInputElement>(
    "input[data-editor-timecode]",
  );
  if (!input) {
    return true;
  }
  if (!input.checkValidity()) {
    input.focus({ preventScroll: true });
    return false;
  }
  input.blur();
  return true;
}
