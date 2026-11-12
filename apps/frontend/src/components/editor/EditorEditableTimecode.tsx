import { Popover } from "@base-ui/react/popover";
import { TimecodeInput } from "@techsquidtv/canvas-timeline/react";
import {
  formatTimecode,
  parseTimecode,
} from "@techsquidtv/canvas-timeline/utils";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { EditorTool } from "@/components/editor/EditorLayout";
import { useEditorTimecodeEdit } from "@/components/editor/EditorTimecodeEdit";
import { cn } from "@/lib/cn";

interface EditorEditableTimecodeProperties {
  ariaLabel: string;
  buttonClassName?: string;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  onCommit: (seconds: number) => void | Promise<void>;
  style?: CSSProperties;
  tool?: EditorTool;
  value: number;
  valueLabel?: string;
}

export function EditorEditableTimecode({
  ariaLabel,
  buttonClassName,
  children,
  className,
  disabled = false,
  onCommit,
  style,
  tool,
  value,
  valueLabel,
}: EditorEditableTimecodeProperties) {
  const buttonReference = useRef<HTMLButtonElement>(null);
  const inputReference = useRef<HTMLInputElement>(null);
  const restoreButtonFocus = useRef(false);
  const { draft, update, finish } = useEditorTimecodeEdit();
  const editing = draft?.id === ariaLabel;
  const text = editing ? draft.value : formatTimecode(value);
  const seconds = editing
    ? parseTimecode(text, { rounding: "centisecond" })
    : null;
  const invalid = editing && text.trim() !== "" && seconds === null;
  const [showError, setShowError] = useState(invalid);
  const errorId = useId();
  const hintId = useId();

  useLayoutEffect(() => {
    const input = inputReference.current;
    if (editing && input && input !== input.ownerDocument.activeElement) {
      input.focus({ preventScroll: true });
    } else if (!editing && restoreButtonFocus.current) {
      restoreButtonFocus.current = false;
      buttonReference.current?.focus();
    }
  }, [editing]);

  useLayoutEffect(() => {
    inputReference.current?.setCustomValidity(
      invalid ? "Enter a valid time." : "",
    );
  }, [invalid]);

  useEffect(() => {
    if (disabled && editing) {
      finish(ariaLabel);
    }
  }, [disabled, editing, finish, ariaLabel]);

  function changeDraft(next: string) {
    update({ id: ariaLabel, value: next, tool: tool ?? null });
    setShowError(false);
  }

  function finishEdit() {
    if (!editing) {
      return;
    }
    if (invalid) {
      setShowError(true);
      return;
    }
    if (finish(ariaLabel) && seconds !== null) {
      void onCommit(seconds);
    }
  }

  return (
    <span
      className={cn("relative inline-flex min-w-0", className)}
      style={style}
    >
      {children && (
        <button
          ref={buttonReference}
          aria-label={
            disabled
              ? `${ariaLabel}: ${valueLabel ?? text}`
              : `Edit ${ariaLabel}: ${valueLabel ?? text}`
          }
          className={cn(
            "editor-control-focus inline-flex min-h-11 min-w-0 items-center border-0 bg-transparent p-0 text-left outline-none disabled:cursor-default lg:min-h-7",
            buttonClassName,
            editing && "invisible",
          )}
          disabled={disabled}
          onClick={() => changeDraft(formatTimecode(value))}
          type="button"
        >
          {children}
        </button>
      )}
      {(!children || editing) && (
        <Popover.Root open={invalid && showError}>
          <TimecodeInput
            ref={inputReference}
            data-editor-timecode={editing || undefined}
            aria-describedby={
              invalid && showError ? `${hintId} ${errorId}` : hintId
            }
            aria-label={`Edit ${ariaLabel}`}
            className={cn(
              "w-full min-h-11 text-right max-lg:text-editor-input! lg:min-h-0",
              children && "absolute inset-0 h-full max-h-full text-left",
            )}
            disabled={disabled}
            enterKeyHint="done"
            invalid={invalid}
            onInvalid={(event) => {
              event.preventDefault();
              setShowError(true);
            }}
            onFocus={(event) => event.currentTarget.select()}
            onValueChange={changeDraft}
            onBlur={finishEdit}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return;
              }
              if ((event.key === "Enter" || event.key === "Tab") && invalid) {
                event.preventDefault();
                setShowError(true);
              } else if (event.key === "Enter") {
                event.preventDefault();
                restoreButtonFocus.current = Boolean(children);
                event.currentTarget.blur();
              } else if (event.key === "Escape" && editing) {
                event.preventDefault();
                restoreButtonFocus.current = Boolean(children);
                finish(ariaLabel);
              }
            }}
            value={text}
          />
          <span id={hintId} className="sr-only">
            Enter seconds, minutes and seconds, or hours minutes and seconds.
            Press Enter to apply. To discard, press Escape or clear the field
            and leave it.
          </span>
          <Popover.Portal>
            <Popover.Positioner
              anchor={inputReference}
              side="bottom"
              align="start"
              sideOffset={4}
              collisionPadding={8}
              className="z-[60]"
            >
              <Popover.Popup
                id={errorId}
                role="alert"
                initialFocus={false}
                finalFocus={false}
                className="z-[60] w-52 max-w-[70vw] rounded-md border border-destructive bg-popover p-2 text-xs font-normal text-popover-foreground shadow-md"
              >
                Enter seconds (12.5), m:ss (1:23), or h:mm:ss (1:02:03). Clear
                the field to keep the previous time.
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
    </span>
  );
}
