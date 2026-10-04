import * as React from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { dialogFooterClasses } from "@/components/ui/control-styles";
import { cn } from "@/lib/utilities";

const Drawer = DrawerPrimitive.Root;
const DrawerTrigger = DrawerPrimitive.Trigger;
const DrawerClose = DrawerPrimitive.Close;

type DrawerContentProperties = Omit<
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Popup>,
  "className"
> & { className?: string };

const DrawerContent = React.forwardRef<HTMLDivElement, DrawerContentProperties>(
  function DrawerContent({ className, children, ...props }, ref) {
    return (
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Backdrop
          data-slot="drawer-overlay"
          className="drawer-overlay fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm"
        />
        <DrawerPrimitive.Viewport
          data-slot="drawer-viewport"
          className="fixed inset-0 z-50 flex items-end pr-(--safe-area-right) pl-(--safe-area-left)"
        >
          <DrawerPrimitive.Popup
            ref={ref}
            data-slot="drawer-content"
            className={cn(
              "drawer-popup relative flex max-h-[min(85dvh,calc(100dvh-var(--safe-area-top)-6rem))] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card pb-[max(var(--drawer-bottom-padding,0px),var(--safe-area-bottom))] text-card-foreground shadow-2xl outline-none",
              className,
            )}
            {...props}
          >
            <div
              aria-hidden="true"
              data-slot="drawer-handle"
              className="flex h-8 shrink-0 touch-none items-center justify-center"
            >
              <div className="h-1.5 w-10 rounded-full bg-muted-foreground/35" />
            </div>
            <DrawerPrimitive.Content className="flex min-h-0 flex-col overflow-y-auto overscroll-contain">
              {children}
            </DrawerPrimitive.Content>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPrimitive.Portal>
    );
  },
);

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid gap-1.5 px-4 py-3 text-center sm:text-left",
        className,
      )}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-auto flex flex-col gap-2",
        dialogFooterClasses,
        className,
      )}
      {...props}
    />
  );
}

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  Omit<
    React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>,
    "className"
  > & { className?: string }
>(function DrawerTitle({ className, ...props }, ref) {
  return (
    <DrawerPrimitive.Title
      ref={ref}
      className={cn(
        "text-sm font-semibold uppercase tracking-[var(--tracking-caps-md)] text-foreground",
        className,
      )}
      {...props}
    />
  );
});

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  Omit<
    React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>,
    "className"
  > & { className?: string }
>(function DrawerDescription({ className, ...props }, ref) {
  return (
    <DrawerPrimitive.Description
      ref={ref}
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
});

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
};
