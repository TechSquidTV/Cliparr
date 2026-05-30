import type { CSSProperties, ReactNode } from "react";
import { PanelRightClose, PanelRightOpen, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EditorSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  active?: boolean;
  icon: LucideIcon;
  resizable?: boolean;
}

const SIDEBAR_STYLE = {
  "--editor-sidebar-width": "22rem",
  "--editor-sidebar-rail-width": "3rem",
} as CSSProperties;

function sidebarControlClassName() {
  return "inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-editor-border bg-editor-control text-muted-foreground transition-colors hover:bg-editor-control-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none";
}

export function EditorSidebar({
  open,
  onOpenChange,
  title,
  description,
  children,
  active = false,
  icon: Icon,
  resizable = false,
}: EditorSidebarProps) {
  return (
    <aside
      style={SIDEBAR_STYLE}
      className={cn(
        "relative flex h-full min-h-0 shrink-0 border border-editor-border bg-editor-panel text-sidebar-foreground transition-[width] duration-200 ease-linear",
        resizable
          ? "w-full"
          : open
            ? "w-[min(var(--editor-sidebar-width),85vw)]"
            : "w-[var(--editor-sidebar-rail-width)]",
      )}
    >
      {open ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className={cn(
              "flex gap-3 border-b border-editor-border bg-editor-panel-muted px-3 py-2.5",
              description ? "items-start" : "items-center",
            )}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className={cn(sidebarControlClassName(), "shrink-0")}
                  aria-label={`Collapse ${title.toLowerCase()} sidebar`}
                >
                  <PanelRightClose className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                Collapse {title.toLowerCase()}
              </TooltipContent>
            </Tooltip>

            <div
              className={cn(
                "min-w-0 flex-1",
                description ? "space-y-1 pt-0.5" : "",
              )}
            >
              <h2 className="text-xs font-semibold uppercase tracking-[var(--tracking-caps-md)] text-sidebar-foreground">
                {title}
              </h2>
              {description ? (
                <p className="text-xs text-muted-foreground">{description}</p>
              ) : null}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden bg-editor-panel">
            {children}
          </div>
        </div>
      ) : (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onOpenChange(true)}
                className={cn(
                  sidebarControlClassName(),
                  "absolute left-2 top-3 z-10",
                )}
                aria-label={`Expand ${title.toLowerCase()} sidebar`}
              >
                <PanelRightOpen className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              Expand {title.toLowerCase()}
            </TooltipContent>
          </Tooltip>

          <div className="flex w-full flex-col items-center justify-between pt-14 pb-3">
            <div className="flex flex-col items-center gap-3">
              <div
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-editor-border text-sidebar-foreground transition-colors",
                  active
                    ? "bg-editor-control-active text-foreground"
                    : "bg-editor-control text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </div>

              <span className="rotate-180 text-[10px] font-semibold uppercase tracking-[var(--tracking-caps-md)] text-muted-foreground [writing-mode:vertical-rl]">
                {title}
              </span>
            </div>

            <div
              aria-hidden="true"
              className={cn(
                "h-2 w-2 border border-editor-border",
                active ? "bg-editor-accent" : "bg-editor-control",
              )}
            />
          </div>
        </>
      )}
    </aside>
  );
}
