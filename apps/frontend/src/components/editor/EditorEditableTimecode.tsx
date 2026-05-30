import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  formatTimecodeInput,
  parseTimecodeInput,
} from "@/components/editor/editorUtils";

interface EditorEditableTimecodeProps {
  ariaLabel: string;
  buttonClassName?: string;
  children: ReactNode;
  disabled?: boolean;
  inputClassName?: string;
  inputWidth?: string;
  onCommit: (seconds: number) => void | Promise<void>;
  value: number;
  valueLabel?: string;
}

export function EditorEditableTimecode({
  ariaLabel,
  buttonClassName = "",
  children,
  disabled = false,
  inputClassName = "",
  inputWidth,
  onCommit,
  value,
  valueLabel,
}: EditorEditableTimecodeProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusAfterEditRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [reservedWidth, setReservedWidth] = useState<string | undefined>(
    undefined,
  );
  const formattedValue = formatTimecodeInput(value);
  const accessibleValue = valueLabel ?? formattedValue;
  const descriptionId = useId();
  const hintId = `${descriptionId}-hint`;
  const errorId = `${descriptionId}-error`;
  const describedBy = invalid ? `${hintId} ${errorId}` : hintId;

  useLayoutEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }

    if (restoreFocusAfterEditRef.current) {
      restoreFocusAfterEditRef.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (disabled && editing) {
      restoreFocusAfterEditRef.current = false;
      setInvalid(false);
      setEditing(false);
    }
  }, [disabled, editing]);

  function startEditing() {
    if (disabled) {
      return;
    }

    const buttonWidth = buttonRef.current?.getBoundingClientRect().width ?? 0;
    setReservedWidth(
      buttonWidth > 0 ? `${buttonWidth.toFixed(3)}px` : undefined,
    );
    setDraftValue(formattedValue);
    setInvalid(false);
    setEditing(true);
  }

  function cancelEditing({ restoreFocus }: { restoreFocus: boolean }) {
    restoreFocusAfterEditRef.current = restoreFocus;
    setInvalid(false);
    setEditing(false);
  }

  function commitParsedValue(
    nextValue: number,
    { restoreFocus }: { restoreFocus: boolean },
  ) {
    restoreFocusAfterEditRef.current = restoreFocus;
    setInvalid(false);
    setEditing(false);
    void onCommit(nextValue);
  }

  function commitDraft({
    cancelOnInvalid,
    restoreFocus,
  }: {
    cancelOnInvalid: boolean;
    restoreFocus: boolean;
  }) {
    const parsedValue = parseTimecodeInput(draftValue);

    if (parsedValue === null) {
      if (cancelOnInvalid) {
        cancelEditing({ restoreFocus });
        return;
      }

      setInvalid(true);
      return;
    }

    commitParsedValue(parsedValue, { restoreFocus });
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft({ cancelOnInvalid: false, restoreFocus: true });
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing({ restoreFocus: true });
    }
  }

  return (
    <span
      className="inline-flex min-w-0"
      style={{ width: editing ? reservedWidth : undefined }}
    >
      {editing ? (
        <input
          ref={inputRef}
          aria-describedby={describedBy}
          aria-errormessage={invalid ? errorId : undefined}
          aria-invalid={invalid || undefined}
          aria-label={`Edit ${ariaLabel}`}
          autoComplete="off"
          className={`h-7 border bg-editor-control px-1.5 font-mono text-sm font-semibold text-foreground outline-none transition-colors focus:ring-2 ${
            invalid
              ? "border-destructive focus:border-destructive focus:ring-destructive/20"
              : "border-editor-border focus:border-editor-accent focus:ring-editor-accent/35"
          } ${inputClassName}`}
          inputMode="text"
          onBlur={() =>
            commitDraft({ cancelOnInvalid: true, restoreFocus: false })
          }
          onChange={(event) => {
            setDraftValue(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={handleInputKeyDown}
          spellCheck={false}
          style={{ width: inputWidth ?? "100%" }}
          type="text"
          value={draftValue}
        />
      ) : (
        <button
          ref={buttonRef}
          aria-label={
            disabled
              ? `${ariaLabel}: ${accessibleValue}`
              : `Edit ${ariaLabel}: ${accessibleValue}`
          }
          className={`inline-flex min-w-0 items-center border-0 bg-transparent p-0 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-editor-accent/35 disabled:cursor-default disabled:opacity-100 ${buttonClassName}`}
          disabled={disabled}
          onClick={startEditing}
          type="button"
        >
          {children}
        </button>
      )}
      {editing && (
        <>
          <span id={hintId} className="sr-only">
            Enter seconds, minutes and seconds, or hours minutes and seconds.
            Press Enter to apply or Escape to cancel.
          </span>
          {invalid && (
            <span id={errorId} className="sr-only" role="alert">
              Invalid timecode. Use seconds, m:ss, or h:mm:ss.
            </span>
          )}
        </>
      )}
    </span>
  );
}
