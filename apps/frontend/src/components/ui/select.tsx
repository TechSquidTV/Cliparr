import * as React from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "#/lib/utilities";

function Select<Value extends string>(
  props: SelectPrimitive.Root.Props<Value>,
) {
  return <SelectPrimitive.Root {...props} />;
}

function SelectGroup(
  props: React.ComponentProps<typeof SelectPrimitive.Group>,
) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue(
  props: React.ComponentProps<typeof SelectPrimitive.Value>,
) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  variant = "default",
  children,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Trigger>, "className"> & {
  className?: string;
  size?: "sm" | "default";
  variant?: "default" | "editor";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "group/select flex w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-control)] border border-input bg-background text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow,border-color] hover:border-ring/50 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[placeholder]:text-muted-foreground *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        size === "sm" ? "h-8 px-2.5 text-xs font-medium" : "h-9 px-3",
        variant === "editor"
          ? "editor-control-focus border-editor-border bg-editor-control text-sidebar-foreground shadow-none hover:bg-editor-control-hover focus-visible:border-editor-accent"
          : "control-focus",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDownIcon className="size-4 opacity-50 transition-transform duration-300 ease-out group-data-[popup-open]/select:rotate-180 motion-reduce:transition-none" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  align = "start",
  sideOffset = 8,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Popup>, "className"> & {
  className?: string;
  align?: React.ComponentProps<typeof SelectPrimitive.Positioner>["align"];
  sideOffset?: number;
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        sideOffset={sideOffset}
        alignItemWithTrigger={false}
        collisionPadding={12}
        className="z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "cliparr-select-content relative max-h-[min(22rem,var(--available-height))] min-w-[max(var(--anchor-width),var(--spacing-select-content-min))] max-w-[calc(100vw-1.5rem)] origin-(--transform-origin) overflow-hidden rounded-[var(--radius-control)] border border-border bg-popover text-popover-foreground shadow-lg",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow className="absolute inset-x-0 top-0 z-10 flex items-center justify-center bg-popover py-1">
            <ChevronUpIcon className="size-4" />
          </SelectPrimitive.ScrollUpArrow>
          <SelectPrimitive.List className="max-h-[inherit] overflow-y-auto p-1.5 scroll-my-1.5">
            {children}
          </SelectPrimitive.List>
          <SelectPrimitive.ScrollDownArrow className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center bg-popover py-1">
            <ChevronDownIcon className="size-4" />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof SelectPrimitive.GroupLabel>,
  "className"
> & {
  className?: string;
}) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof SelectPrimitive.Item>,
  "className" | "value"
> & {
  className?: string;
  value: string;
}) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-9 w-full cursor-default items-center gap-2 rounded-[var(--radius-control)] py-2 pr-8 pl-2.5 text-sm text-muted-foreground outline-hidden select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[selected]:bg-muted data-[selected]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <CheckIcon className="size-4" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText className="flex items-center gap-2">
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
};
