import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  formatTimecodeInput,
  parseTimecodeInput,
} from "@/components/editor/editorUtilities";
import { cn } from "@/lib/utilities";
import { Popover } from "@base-ui/react/popover";

interface EditorEditableTimecodeProperties {
  ariaLabel: string;
  buttonClassName?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  inputClassName?: string;
  inputWidth?: string;
  onCommit: (seconds: number) => void | Promise<void>;
  style?: CSSProperties;
  value: number;
  valueLabel?: string;
}

export function EditorEditableTimecode({
  ariaLabel,
  buttonClassName = "",
  children,
  className = "",
  disabled = false,
  inputClassName = "",
  inputWidth,
  onCommit,
  style,
  value,
  valueLabel,
}: EditorEditableTimecodeProperties) {
  const buttonReference = useRef<HTMLButtonElement>(null);
  const inputReference = useRef<HTMLInputElement>(null);
  const restoreFocusAfterEditReference = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [reservedWidth, setReservedWidth] = useState<string | undefined>();
  const formattedValue = formatTimecodeInput(value);
  const accessibleValue = valueLabel ?? formattedValue;
  const descriptionId = useId();
  const hintId = `${descriptionId}-hint`;
  const errorId = `${descriptionId}-error`;
  const describedBy = invalid ? `${hintId} ${errorId}` : hintId;

  useLayoutEffect(() => {
    if (editing) {
      inputReference.current?.focus();
      inputReference.current?.select();
      return;
    }

    if (restoreFocusAfterEditReference.current) {
      restoreFocusAfterEditReference.current = false;
      buttonReference.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (disabled && editing) {
      restoreFocusAfterEditReference.current = false;
      setInvalid(false);
      setEditing(false);
    }
  }, [disabled, editing]);

  function startEditing() {
    if (disabled) {
      return;
    }

    const buttonWidth =
      buttonReference.current?.getBoundingClientRect().width ?? 0;
    setReservedWidth(
      buttonWidth > 0 ? `${buttonWidth.toFixed(3)}px` : undefined,
    );
    setDraftValue(formattedValue);
    setInvalid(false);
    setEditing(true);
  }

  function cancelEditing({ restoreFocus }: { restoreFocus: boolean }) {
    restoreFocusAfterEditReference.current = restoreFocus;
    setInvalid(false);
    setEditing(false);
  }

  function commitParsedValue(
    nextValue: number,
    { restoreFocus }: { restoreFocus: boolean },
  ) {
    restoreFocusAfterEditReference.current = restoreFocus;
    setInvalid(false);
    setEditing(false);
    void onCommit(nextValue);
  }

  function commitDraft({ restoreFocus }: { restoreFocus: boolean }) {
    const parsedValue = parseTimecodeInput(draftValue);

    if (parsedValue === null) {
      setInvalid(true);
      return;
    }

    commitParsedValue(parsedValue, { restoreFocus });
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft({ restoreFocus: true });
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing({ restoreFocus: true });
    }
  }

  return (
    <span
      className={`relative inline-flex min-w-0 ${className}`}
      style={{
        ...style,
        width: editing ? (reservedWidth ?? style?.width) : style?.width,
      }}
    >
      {editing ? (
        <Popover.Root open={invalid}>
          <input
            ref={inputReference}
            aria-describedby={describedBy}
            aria-errormessage={invalid ? errorId : undefined}
            aria-invalid={invalid || undefined}
            aria-label={`Edit ${ariaLabel}`}
            autoComplete="off"
            className={cn(
              "editor-control-focus h-7 border bg-editor-control px-1.5 font-mono text-sm font-semibold text-foreground outline-none transition-colors",
              invalid
                ? "border-destructive focus-visible:border-destructive"
                : "border-editor-border focus-visible:border-editor-accent",
              inputClassName,
            )}
            inputMode="text"
            onBlur={() => commitDraft({ restoreFocus: false })}
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
                Enter seconds (12.5), m:ss (1:23), or h:mm:ss (1:02:03). Press
                Escape to discard this edit.
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        <button
          ref={buttonReference}
          aria-label={
            disabled
              ? `${ariaLabel}: ${accessibleValue}`
              : `Edit ${ariaLabel}: ${accessibleValue}`
          }
          className={`editor-control-focus inline-flex min-w-0 items-center border-0 bg-transparent p-0 text-left outline-none transition-colors disabled:cursor-default disabled:opacity-100 ${buttonClassName}`}
          disabled={disabled}
          onClick={startEditing}
          type="button"
        >
          {children}
        </button>
      )}
      {editing && (
        <span id={hintId} className="sr-only">
          Enter seconds, minutes and seconds, or hours minutes and seconds.
          Press Enter to apply or Escape to cancel.
        </span>
      )}
    </span>
  );
}
