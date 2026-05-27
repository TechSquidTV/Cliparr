import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  formatTimecodeInput,
  parseTimecodeInput,
} from "./EditorUtils";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const formattedValue = formatTimecodeInput(value);
  const accessibleValue = valueLabel ?? formattedValue;

  useEffect(() => {
    if (!editing) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (disabled && editing) {
      setInvalid(false);
      setEditing(false);
    }
  }, [disabled, editing]);

  function startEditing() {
    if (disabled) {
      return;
    }

    setDraftValue(formattedValue);
    setInvalid(false);
    setEditing(true);
  }

  function cancelEditing() {
    setInvalid(false);
    setEditing(false);
  }

  function commitParsedValue(nextValue: number) {
    setInvalid(false);
    setEditing(false);
    void onCommit(nextValue);
  }

  function commitDraft({ cancelOnInvalid }: { cancelOnInvalid: boolean }) {
    const parsedValue = parseTimecodeInput(draftValue);

    if (parsedValue === null) {
      if (cancelOnInvalid) {
        cancelEditing();
        return;
      }

      setInvalid(true);
      return;
    }

    commitParsedValue(parsedValue);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft({ cancelOnInvalid: false });
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        className={`h-7 border bg-background px-1.5 font-mono text-sm font-semibold text-foreground outline-none transition-colors focus:ring-2 ${
          invalid
            ? "border-destructive focus:border-destructive focus:ring-destructive/20"
            : "border-input focus:border-ring focus:ring-ring/40"
        } ${inputClassName}`}
        inputMode="text"
        onBlur={() => commitDraft({ cancelOnInvalid: true })}
        onChange={(event) => {
          setDraftValue(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={handleInputKeyDown}
        style={inputWidth ? { width: inputWidth } : undefined}
        type="text"
        value={draftValue}
      />
    );
  }

  return (
    <button
      aria-label={disabled ? `${ariaLabel}: ${accessibleValue}` : `Edit ${ariaLabel}: ${accessibleValue}`}
      className={`inline-flex min-w-0 items-center border-0 bg-transparent p-0 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/45 disabled:cursor-default disabled:opacity-100 ${buttonClassName}`}
      disabled={disabled}
      onClick={startEditing}
      type="button"
    >
      {children}
    </button>
  );
}
