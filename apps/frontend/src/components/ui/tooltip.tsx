import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "#/lib/utilities";

function TooltipProvider({
  delay = 250,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delay={delay} {...props} />;
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  side = "top",
  align = "center",
  children,
  ...props
}: Omit<React.ComponentProps<typeof TooltipPrimitive.Popup>, "className"> & {
  className?: string;
  side?: React.ComponentProps<typeof TooltipPrimitive.Positioner>["side"];
  align?: React.ComponentProps<typeof TooltipPrimitive.Positioner>["align"];
  sideOffset?: number;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-[60]"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "max-w-72 rounded-md border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md origin-(--transform-origin) data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95 data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="size-2 rotate-45 bg-popover data-[side=top]:-bottom-1 data-[side=bottom]:-top-1 data-[side=left]:-right-1 data-[side=right]:-left-1" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

interface ControlTooltipProperties {
  label?: string | null;
  disabled?: boolean;
  children: React.ReactElement;
  side?: React.ComponentProps<typeof TooltipContent>["side"];
}

export function ControlTooltip({ label, ...props }: ControlTooltipProperties) {
  return label ? (
    <LabeledControlTooltip label={label} {...props} />
  ) : (
    props.children
  );
}

function LabeledControlTooltip({
  label,
  disabled = false,
  children,
  side = "bottom",
}: ControlTooltipProperties & { label: string }) {
  const [open, setOpen] = React.useState(false);
  const nestedTriggerReference = React.useRef(false);

  function trackTrigger(event: React.SyntheticEvent<HTMLElement>) {
    const target = event.target;
    const nested =
      target instanceof Element &&
      target.closest('[data-slot="tooltip-trigger"]') !== event.currentTarget;
    nestedTriggerReference.current = nested;
    if (nested) {
      setOpen(false);
    }
  }

  return (
    <Tooltip
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen && !nestedTriggerReference.current);
      }}
    >
      <TooltipTrigger
        onFocusCapture={trackTrigger}
        onPointerMoveCapture={trackTrigger}
        render={
          disabled ? (
            <span className="inline-flex" tabIndex={0}>
              {children}
            </span>
          ) : (
            children
          )
        }
      />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
