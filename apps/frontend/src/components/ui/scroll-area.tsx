import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import * as React from "react";
import { cn } from "@/lib/utilities";

type ScrollAreaProperties = React.ComponentPropsWithoutRef<
  typeof BaseScrollArea.Root
> & {
  viewportClassName?: string;
  contentClassName?: string;
};
type ScrollBarProperties = React.ComponentPropsWithoutRef<
  typeof BaseScrollArea.Scrollbar
> & {
  thumbClassName?: string;
};

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProperties>(
  function ScrollArea(
    { children, className, contentClassName, viewportClassName, ...props },
    ref,
  ) {
    return (
      <BaseScrollArea.Root
        {...props}
        className={cn("relative overflow-hidden", className)}
        data-slot="scroll-area"
        ref={ref}
      >
        <BaseScrollArea.Viewport
          className={cn(
            "w-full rounded-[inherit] outline-none",
            viewportClassName,
          )}
          data-slot="scroll-area-viewport"
        >
          <BaseScrollArea.Content
            className={cn("min-w-0", contentClassName)}
            data-slot="scroll-area-content"
          >
            {children}
          </BaseScrollArea.Content>
        </BaseScrollArea.Viewport>
        <ScrollBar />
        <BaseScrollArea.Corner
          className="bg-transparent"
          data-slot="scroll-area-corner"
        />
      </BaseScrollArea.Root>
    );
  },
);

const ScrollBar = React.forwardRef<HTMLDivElement, ScrollBarProperties>(
  function ScrollBar(
    { className, orientation = "vertical", thumbClassName, ...props },
    ref,
  ) {
    return (
      <BaseScrollArea.Scrollbar
        {...props}
        orientation={orientation}
        className={cn(
          "flex touch-none p-px select-none transition-colors data-[orientation=horizontal]:absolute data-[orientation=horizontal]:right-0 data-[orientation=horizontal]:bottom-0 data-[orientation=horizontal]:left-0 data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:absolute data-[orientation=vertical]:top-0 data-[orientation=vertical]:right-0 data-[orientation=vertical]:bottom-0 data-[orientation=vertical]:w-2.5",
          className,
        )}
        data-slot="scroll-area-scrollbar"
        ref={ref}
      >
        <BaseScrollArea.Thumb
          className={cn(
            "relative flex-1 rounded-full bg-border/80 transition-colors hover:bg-muted-foreground/60 before:absolute before:inset-0 before:-m-1",
            thumbClassName,
          )}
          data-slot="scroll-area-thumb"
        />
      </BaseScrollArea.Scrollbar>
    );
  },
);

export { ScrollArea };
