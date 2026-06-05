import * as React from "react";
import { GripVertical } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { cn } from "@/lib/utilities";

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof Group>) {
  return <Group className={cn("h-full w-full", className)} {...props} />;
}

function ResizablePanel({
  className,
  ...props
}: React.ComponentProps<typeof Panel>) {
  return <Panel className={cn("min-h-0 min-w-0", className)} {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean;
}) {
  return (
    <Separator
      className={cn(
        "group relative flex shrink-0 items-center justify-center bg-transparent transition-colors hover:bg-editor-border/80 focus-visible:bg-editor-border/80 focus-visible:ring-2 focus-visible:ring-editor-accent/35 focus-visible:outline-none",
        "aria-[orientation=vertical]:h-full aria-[orientation=vertical]:w-2 aria-[orientation=vertical]:cursor-col-resize",
        "aria-[orientation=horizontal]:h-2 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <span className="z-10 flex h-7 w-4 items-center justify-center text-muted-foreground transition-colors group-hover:text-foreground group-focus-visible:text-foreground group-aria-[orientation=horizontal]:h-4 group-aria-[orientation=horizontal]:w-7 group-aria-[orientation=horizontal]:rotate-90">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
