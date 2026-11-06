import { Popover } from "@base-ui/react/popover";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { EditorTool } from "@/components/editor/EditorLayout";
import { useEditorTimecodeEdit } from "@/components/editor/EditorTimecodeEdit";
import {
  formatTimecodeInput,
  parseTimecodeInput,
} from "@/components/editor/editorUtilities";
import { cn } from "@/lib/cn";

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
  tool?: EditorTool;
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
  tool,
  value,
  valueLabel,
}: EditorEditableTimecodeProperties) {
  const buttonReference = useRef<HTMLButtonElement>(null);
  const inputReference = useRef<HTMLInputElement>(null);
  const restoreFocusAfterEditReference = useRef(false);
  const { draft, update, finish } = useEditorTimecodeEdit();
  const editing = draft?.id === ariaLabel;
  const draftValue = editing ? (draft?.value ?? "") : "";
  const [invalid, setInvalid] = useState(
    editing && parseTimecodeInput(draftValue) === null,
  );
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

  useLayoutEffect(() => {
    if (editing) {
      inputReference.current?.setCustomValidity(
        parseTimecodeInput(draftValue) === null
          ? "Enter a valid time or cancel this edit."
          : "",
      );
    }
  }, [editing, draftValue]);
  useEffect(() => {
    if (disabled && editing) {
      restoreFocusAfterEditReference.current = false;
      setInvalid(false);
      finish(ariaLabel);
    }
  }, [disabled, editing, finish, ariaLabel]);

  function startEditing() {
    if (disabled) {
      return;
    }

    update({ id: ariaLabel, value: formattedValue, tool: tool ?? null });
    setInvalid(false);
  }

  function cancelEditing({ restoreFocus }: { restoreFocus: boolean }) {
    restoreFocusAfterEditReference.current = restoreFocus;
    setInvalid(false);
    finish(ariaLabel);
  }

  function commitParsedValue(
    nextValue: number,
    { restoreFocus }: { restoreFocus: boolean },
  ) {
    restoreFocusAfterEditReference.current = restoreFocus;
    setInvalid(false);
    if (finish(ariaLabel)) {
      void onCommit(nextValue);
    }
  }

  function commitDraft({ restoreFocus }: { restoreFocus: boolean }) {
    const parsedValue = parseTimecodeInput(draftValue);

    if (parsedValue === null) {
      inputReference.current?.setCustomValidity(
        "Enter a valid time or cancel this edit.",
      );
      setInvalid(true);
      return;
    }

    commitParsedValue(parsedValue, { restoreFocus });
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter" && event.target === inputReference.current) {
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
      data-editor-timecode-edit={editing || undefined}
      className={cn(
        "relative inline-flex min-w-0",
        editing && "max-w-full flex-wrap gap-1",
        className,
      )}
      onBlur={
        editing
          ? (event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                commitDraft({ restoreFocus: false });
              }
            }
          : undefined
      }
      onKeyDown={editing ? handleEditKeyDown : undefined}
      style={{
        ...style,
        width: editing ? undefined : style?.width,
      }}
    >
      {editing ? (
        <Popover.Root open={invalid}>
          <input
            ref={inputReference}
            data-editor-timecode
            onInvalid={(event) => {
              event.preventDefault();
              setInvalid(true);
            }}
            aria-describedby={describedBy}
            aria-errormessage={invalid ? errorId : undefined}
            aria-invalid={invalid || undefined}
            aria-label={`Edit ${ariaLabel}`}
            autoComplete="off"
            className={cn(
              "editor-control-focus min-w-0 max-w-full flex-[1_0_auto] h-11 lg:h-7 border bg-editor-control px-1.5 font-mono text-editor-input lg:text-sm font-semibold text-foreground outline-none transition-colors",
              invalid
                ? "border-destructive focus-visible:border-destructive"
                : "border-editor-border focus-visible:border-editor-accent",
              inputClassName,
            )}
            inputMode="text"
            onChange={(event) => {
              event.currentTarget.setCustomValidity(
                parseTimecodeInput(event.target.value) === null
                  ? "Enter a valid time or cancel this edit."
                  : "",
              );
              update({
                id: ariaLabel,
                value: event.target.value,
                tool: tool ?? null,
              });
              setInvalid(false);
            }}
            spellCheck={false}
            style={{
              width:
                inputWidth ??
                `calc(${Math.max(8, formattedValue.length)}ch + 0.75rem)`,
            }}
            type="text"
            value={draftValue}
          />
          <button
            type="button"
            data-editor-cancel-edit
            aria-label={`Cancel ${ariaLabel} edit`}
            className="editor-control-focus min-h-11 shrink-0 px-2 text-editor-property lg:min-h-7 lg:text-xs"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => cancelEditing({ restoreFocus: true })}
          >
            Cancel
          </button>
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
          className={`editor-control-focus inline-flex min-h-11 min-w-0 items-center border-0 bg-transparent p-0 text-left outline-none transition-colors disabled:cursor-default disabled:opacity-100 lg:min-h-0 ${buttonClassName}`}
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
