import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function editorPropertyLabelClassName() {
  return "text-ui-micro font-normal normal-case tracking-normal text-muted-foreground";
}

export function editorPropertySelectTriggerClassName() {
  return "h-8 w-full min-w-0 rounded-[var(--radius-control)] border-editor-border bg-editor-control px-2.5 text-xs font-medium text-sidebar-foreground shadow-none hover:bg-editor-control-hover focus-visible:ring-2 focus-visible:ring-editor-accent/35";
}

export function EditorPropertySection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-editor-border/80 px-3 py-3 last:border-b-0">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <div className={editorPropertyLabelClassName()}>{title}</div>
        {action}
      </div>
      <div className="mt-2.5 space-y-2.5">{children}</div>
    </section>
  );
}

export function EditorPropertyRow({
  label,
  value,
  children,
  align = "center",
}: {
  label: string;
  value?: ReactNode;
  children: ReactNode;
  align?: "center" | "start";
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
      <span className={labelClassName}>{label}</span>
      <span className="min-w-0">
        {value ? (
          <span className="mb-1 flex justify-end font-mono text-ui-micro text-muted-foreground">
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
  const rangeFillPercent =
    max > min ? Math.min(Math.max((value - min) / (max - min), 0), 1) * 100 : 0;

  return (
    <EditorPropertyRow
      label={label}
      value={
        <>
          {value}
          {unit}
        </>
      }
      align="start"
    >
      <input
        type="range"
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
      <span className="flex h-8 min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2">
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
        <span className="min-w-0 truncate font-mono text-ui-label text-sidebar-foreground">
          {value.toUpperCase()}
        </span>
      </span>
    </EditorPropertyRow>
  );
}
