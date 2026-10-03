import { cn } from "#/lib/utilities";

export const fieldLabelWideClasses =
  "text-ui-label font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground";

export const primaryButtonClasses =
  "control-focus inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-4 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60";

export const densePrimaryButtonClasses =
  "control-focus inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60";

export const compactPrimaryButtonClasses =
  "control-focus inline-flex h-8 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButtonClasses =
  "control-focus inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";

export const denseSecondaryButtonClasses =
  "control-focus inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";

export const compactSecondaryButtonClasses =
  "control-focus inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";

export const subtleButtonClasses =
  "control-focus inline-flex h-9 items-center justify-center rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

export const iconButtonClasses =
  "control-focus inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60";

export function editorIconButtonClassName({
  size = "md",
  variant = "outline",
  className,
}: {
  size?: "sm" | "md" | "lg";
  variant?: "outline" | "ghost";
  className?: string;
} = {}) {
  return cn(
    "editor-control-focus inline-flex items-center justify-center rounded-[var(--radius-control)] text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
    { sm: "h-7 w-7", md: "h-8 w-8", lg: "h-10 w-10" }[size],
    variant === "outline" && "border border-editor-border bg-editor-control",
    className,
  );
}

export const textInputClasses =
  "control-focus h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60";

export const largeTextInputClasses =
  "control-focus h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60";

export const screenTextInputClasses =
  "control-focus h-11 w-full rounded-2xl border border-input bg-card px-4 text-sm text-foreground outline-none transition-colors focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60";

export const destructiveAlertClasses =
  "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive";

export const primaryAlertClasses =
  "rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-foreground";

export const dialogFooterClasses =
  "shrink-0 border-t border-border bg-card px-4 py-3";

export const warningSurfaceClasses =
  "border-status-warning-border bg-status-warning text-status-warning-foreground";

export const warningAlertClasses = `rounded-md border px-3 py-2 text-sm ${warningSurfaceClasses}`;
