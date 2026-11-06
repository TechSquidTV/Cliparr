import { Accordion } from "@base-ui/react/accordion";
import { ChevronRight } from "lucide-react";
import { type CSSProperties, type ReactNode, useId } from "react";

import { cn } from "#/lib/cn";

function editorPropertyLabelClassName() {
  return "text-editor-property lg:text-ui-micro font-normal normal-case tracking-normal text-muted-foreground";
}

export function EditorPropertySection({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty titles and falsy React nodes do not create a header.
  const hasHeader = Boolean(title || action);

  return (
    <section className="border-b border-editor-border/80 px-3 py-3 last:border-b-0">
      {hasHeader && (
        <div className="flex min-h-7 items-center justify-between gap-3">
          <div className={editorPropertyLabelClassName()}>{title}</div>
          {action}
        </div>
      )}
      <div className={cn("space-y-2.5", hasHeader && "mt-2.5")}>{children}</div>
    </section>
  );
}

export function EditorPropertyAccordion<Value extends string>({
  value,
  onValueChange,
  children,
  multiple = true,
  className,
}: {
  value: readonly Value[];
  onValueChange: (value: Value[]) => void;
  children: ReactNode;
  multiple?: boolean;
  className?: string;
}) {
  return (
    <Accordion.Root
      multiple={multiple}
      value={[...value]}
      onValueChange={onValueChange}
      className={cn("flex min-h-0 flex-col", className)}
    >
      {children}
    </Accordion.Root>
  );
}

export function EditorPropertyAccordionItem<Value extends string>({
  value,
  title,
  action,
  children,
  fillAvailable = false,
  disabled = false,
}: {
  value: Value;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  fillAvailable?: boolean;
  disabled?: boolean;
}) {
  return (
    <Accordion.Item
      value={value}
      disabled={disabled}
      className={cn(
        "border-b border-editor-border/80",
        fillAvailable &&
          "flex min-h-0 shrink-0 grow-0 flex-col transition-[flex-grow] duration-250 ease-in-out motion-reduce:transition-none data-[open]:grow",
      )}
    >
      <Accordion.Header
        className={cn(
          "m-0 flex shrink-0 items-center gap-2 border-b border-editor-border/70 bg-editor-panel-muted/55 px-3",
          fillAvailable ? "min-h-9" : "min-h-10 py-2",
        )}
      >
        <Accordion.Trigger
          className={cn(
            "editor-control-focus group flex min-w-0 flex-1 items-center gap-2 bg-transparent text-left text-xs font-semibold uppercase tracking-[var(--tracking-caps-md)] text-sidebar-foreground transition-colors hover:text-foreground disabled:opacity-45",
            fillAvailable && "min-h-11 lg:min-h-9",
          )}
        >
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none group-data-[panel-open]:rotate-90" />
          <span className="min-w-0 truncate">{title}</span>
        </Accordion.Trigger>
        {action ? <span className="shrink-0">{action}</span> : null}
      </Accordion.Header>
      <Accordion.Panel
        className={
          fillAvailable
            ? "h-0 min-h-0 flex-[1_1_0px] overflow-hidden opacity-100 transition-opacity duration-250 ease-in-out motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0"
            : "h-[var(--accordion-panel-height)] overflow-hidden transition-[height] duration-150 ease-out motion-reduce:transition-none data-ending-style:h-0 data-starting-style:h-0"
        }
      >
        <div className={fillAvailable ? "h-full min-h-0" : undefined}>
          {children}
        </div>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

export function EditorPropertyRow({
  label,
  value,
  children,
  align = "center",
  labelId,
}: {
  label: string;
  value?: ReactNode;
  children: ReactNode;
  align?: "center" | "start";
  labelId?: string;
}) {
  const labelClassName =
    editorPropertyLabelClassName() + (align === "start" ? " pt-2" : "");

  return (
    <div
      className={cn(
        "grid min-h-8 grid-cols-editor-property-row gap-3",
        align === "start" ? "items-start" : "items-center",
      )}
    >
      <span id={labelId} className={labelClassName}>
        {label}
      </span>
      <span className="min-w-0">
        {value ? (
          <span className="mb-1 flex justify-end font-mono text-editor-property text-muted-foreground lg:text-ui-micro">
            {value}
          </span>
        ) : null}
        {children}
      </span>
    </div>
  );
}

export function EditorRangeControl({
  label,
  value,
  min,
  max,
  step,
  unit = "",
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const labelId = useId();
  const rangeFillPercent =
    max > min ? Math.min(Math.max((value - min) / (max - min), 0), 1) * 100 : 0;
  const stepFractionDigits = step.toString().split(".")[1]?.length ?? 0;
  const widestSteppedValueLength =
    stepFractionDigits > 0
      ? Math.max(
          `${min.toFixed(stepFractionDigits)}${unit}`.length,
          `${max.toFixed(stepFractionDigits)}${unit}`.length,
        )
      : 0;
  const valueSlotWidth = `${Math.max(
    4,
    `${min}${unit}`.length,
    `${max}${unit}`.length,
    widestSteppedValueLength,
  )}ch`;

  return (
    <EditorPropertyRow
      label={label}
      labelId={labelId}
      value={
        <span
          className="inline-block text-right tabular-nums"
          style={{ width: valueSlotWidth }}
        >
          {value}
          {unit}
        </span>
      }
      align="start"
    >
      <input
        type="range"
        aria-labelledby={labelId}
        aria-valuetext={`${value}${unit}`}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="cliparr-editor-range w-full"
        style={
          {
            "--cliparr-range-fill": `${rangeFillPercent}%`,
          } as CSSProperties
        }
      />
    </EditorPropertyRow>
  );
}

export function EditorColorControl({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <EditorPropertyRow label={label}>
      <span className="flex h-11 min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2 lg:h-8">
        <span className="relative h-4 w-6 shrink-0">
          <span
            aria-hidden="true"
            className="absolute inset-0 border border-editor-border"
            style={{ backgroundColor: value }}
          />
          <input
            type="color"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0 disabled:cursor-not-allowed"
            aria-label={label}
          />
        </span>
        <span className="min-w-0 truncate font-mono text-editor-property text-sidebar-foreground lg:text-ui-label">
          {value.toUpperCase()}
        </span>
      </span>
    </EditorPropertyRow>
  );
}
