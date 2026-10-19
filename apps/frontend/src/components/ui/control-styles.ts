import { cn } from "#/lib/cn";

export const fieldLabelWideClasses =
  "text-ui-label font-semibold uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground";

const disabledCursorClasses = "disabled:cursor-not-allowed";

export function buttonClassName({
  tone = "primary",
  size = "default",
  typography = (
    {
      primary: "caps",
      secondary: "caps",
      destructive: "caps",
      subtle: "plain",
      icon: "inherit",
    } as const
  )[tone],
  className,
}: {
  tone?: "primary" | "secondary" | "subtle" | "destructive" | "icon";
  size?: "default" | "dense" | "compact" | "icon";
  typography?: "caps" | "plain" | "inherit";
  className?: string;
} = {}) {
  return cn(
    "control-focus inline-flex items-center justify-center gap-2 rounded-md transition-colors",
    tone !== "subtle" && [disabledCursorClasses, "disabled:opacity-60"],
    {
      default: "h-9 px-4",
      dense: "h-9 px-3",
      compact: "h-8 px-3",
      icon: "h-8 w-8",
    }[size],
    {
      primary:
        "border border-primary bg-primary text-primary-foreground hover:bg-primary/90",
      secondary:
        "border border-border bg-background text-foreground hover:bg-accent",
      subtle: "text-muted-foreground hover:bg-accent hover:text-foreground",
      destructive:
        "border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground",
      icon: "border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
    }[tone],
    {
      caps: "text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)]",
      plain: "text-xs font-medium normal-case tracking-normal",
      inherit: "",
    }[typography],
    className,
  );
}

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
    "editor-control-focus inline-flex items-center justify-center rounded-[var(--radius-control)] text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground disabled:opacity-50",
    disabledCursorClasses,
    { sm: "h-7 w-7", md: "h-8 w-8", lg: "h-10 w-10" }[size],
    variant === "outline" && "border border-editor-border bg-editor-control",
    className,
  );
}

export function textInputClassName({
  size = "default",
  className,
}: {
  size?: "default" | "large" | "screen";
  className?: string;
} = {}) {
  return cn(
    "control-focus w-full border border-input text-sm text-foreground outline-none transition-colors focus-visible:border-ring disabled:opacity-60",
    disabledCursorClasses,
    {
      default: "h-9 rounded-md bg-background px-3",
      large: "h-10 rounded-md bg-background px-3",
      screen: "h-11 rounded-2xl bg-card px-4",
    }[size],
    className,
  );
}

export const destructiveAlertClasses =
  "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive";

export const primaryAlertClasses =
  "rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-foreground";

export const dialogFooterClasses =
  "shrink-0 border-t border-border bg-card px-4 py-3";

export const warningSurfaceClasses =
  "border-status-warning-border bg-status-warning text-status-warning-foreground";

export const warningAlertClasses = `rounded-md border px-3 py-2 text-sm ${warningSurfaceClasses}`;
