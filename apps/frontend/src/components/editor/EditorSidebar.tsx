import type { CSSProperties, ReactNode } from "react";
import { Captions, PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditorSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  active?: boolean;
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
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(sidebarControlClassName(), "absolute left-2 top-3 z-10")}
        aria-label={`${open ? "Collapse" : "Expand"} ${title.toLowerCase()} sidebar`}
      >
        {open ? (
          <PanelRightClose className="h-4 w-4" />
        ) : (
          <PanelRightOpen className="h-4 w-4" />
        )}
      </button>

      {open ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-sidebar-border py-3 pr-3 pl-12">
            <div className="flex items-start gap-3">
              <div className="min-w-0 space-y-1">
                <h2 className="text-sm font-semibold uppercase tracking-[var(--tracking-caps-md)] text-sidebar-foreground">
                  {title}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {description}
                </p>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden">
            {children}
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-col items-center justify-between pt-14 pb-3">
          <div className="flex flex-col items-center gap-3">
            <div className={cn(
              "grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-sidebar-border text-sidebar-foreground transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "bg-sidebar-accent text-sidebar-accent-foreground"
            )}>
              <Captions className="h-4 w-4" />
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
      )}
    </aside>
  );
}
