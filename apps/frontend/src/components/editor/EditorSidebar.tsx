import type { CSSProperties, ReactNode } from "react";
import { PanelRightClose, PanelRightOpen, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditorSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  active?: boolean;
  icon: LucideIcon;
}

const SIDEBAR_STYLE = {
  "--editor-sidebar-width": "21rem",
  "--editor-sidebar-rail-width": "3rem",
} as CSSProperties;

function sidebarControlClassName() {
  return "inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground transition-colors hover:bg-sidebar-primary hover:text-sidebar-primary-foreground";
}

export function EditorSidebar({
  open,
  onOpenChange,
  title,
  description,
  children,
  active = false,
  icon: Icon,
}: EditorSidebarProps) {
  return (
    <aside
      style={SIDEBAR_STYLE}
      className={cn(
        "relative flex h-full min-h-0 shrink-0 border border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-linear",
        open
          ? "w-[min(var(--editor-sidebar-width),85vw)]"
          : "w-[var(--editor-sidebar-rail-width)]"
      )}
    >
      {open ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <header className={cn(
            "flex gap-3 border-b border-sidebar-border p-3",
            description ? "items-start" : "items-center",
          )}>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={cn(sidebarControlClassName(), "shrink-0")}
              aria-label={`Collapse ${title.toLowerCase()} sidebar`}
            >
              <PanelRightClose className="h-4 w-4" />
            </button>

            <div className={cn(
              "min-w-0 flex-1",
              description ? "space-y-1 pt-0.5" : "",
            )}>
              <h2 className="text-sm font-semibold uppercase tracking-[var(--tracking-caps-md)] text-sidebar-foreground">
                {title}
              </h2>
              {description ? (
                <p className="text-xs text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden">
            {children}
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            className={cn(sidebarControlClassName(), "absolute left-2 top-3 z-10")}
            aria-label={`Expand ${title.toLowerCase()} sidebar`}
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>

          <div className="flex w-full flex-col items-center justify-between pt-14 pb-3">
          <div className="flex flex-col items-center gap-3">
            <div className={cn(
              "grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-sidebar-border text-sidebar-foreground transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "bg-sidebar-accent text-sidebar-accent-foreground"
            )}>
              <Icon className="h-4 w-4" />
            </div>

            <span className="rotate-180 text-[10px] font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground [writing-mode:vertical-rl]">
              {title}
            </span>
          </div>

          <div
            aria-hidden="true"
            className={cn(
              "h-2 w-2 border border-sidebar-border",
              active ? "bg-sidebar-primary" : "bg-sidebar-accent"
            )}
          />
          </div>
        </>
      )}
    </aside>
  );
}
