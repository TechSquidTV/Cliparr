import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { motion, type HTMLMotionProps, type Transition } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

type TabsRootProps = React.ComponentProps<typeof BaseTabs.Root>;
type TabsListProps = Omit<
  React.ComponentProps<typeof BaseTabs.List>,
  "className" | "ref"
> & {
  className?: string;
  indicatorClassName?: string;
};
type TabsTabProps = Omit<
  React.ComponentProps<typeof BaseTabs.Tab>,
  "className" | "ref"
> & {
  className?: string;
};
type TabsPanelsProps = Omit<
  HTMLMotionProps<"div">,
  "children" | "transition"
> & {
  children: React.ReactNode;
  mode?: "auto-height" | "layout";
  transition?: Transition;
};
type TabsPanelProps = Omit<
  React.ComponentProps<typeof BaseTabs.Panel>,
  "className" | "ref" | "render"
> & {
  className?: string;
  transition?: Transition;
};

const tabsPanelsTransition = {
  type: "spring",
  stiffness: 200,
  damping: 25,
} as const;

const tabsPanelTransition = {
  duration: 0.28,
  ease: "easeInOut",
} as const;

const Tabs = React.forwardRef<HTMLDivElement, TabsRootProps>(function Tabs(
  { className, ...props },
  ref,
) {
  return (
    <BaseTabs.Root ref={ref} className={cn("min-w-0", className)} {...props} />
  );
});

const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(
  function TabsList(
    { className, indicatorClassName, children, ...props },
    ref,
  ) {
    return (
      <BaseTabs.List
        ref={ref}
        className={cn(
          "relative isolate inline-flex overflow-hidden rounded-md border border-border bg-background p-1",
          className,
        )}
        {...props}
      >
        <BaseTabs.Indicator
          renderBeforeHydration
          className={cn(
            "absolute z-0 rounded-[var(--radius-control)] bg-primary transition-[top,left,width,height] duration-200 ease-out",
            "top-[var(--active-tab-top)] left-[var(--active-tab-left)] h-[var(--active-tab-height)] w-[var(--active-tab-width)]",
            indicatorClassName,
          )}
        />
        {children}
      </BaseTabs.List>
    );
  },
);

const TabsTab = React.forwardRef<HTMLElement, TabsTabProps>(function TabsTab(
  { className, ...props },
  ref,
) {
  return (
    <BaseTabs.Tab
      ref={ref}
      className={cn(
        "relative z-10 inline-flex h-8 items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none data-[active]:text-primary-foreground data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55",
        className,
      )}
      {...props}
    />
  );
});

const TabsPanels = React.forwardRef<HTMLDivElement, TabsPanelsProps>(
  function TabsPanels(
    {
      children,
      className,
      mode = "auto-height",
      transition = tabsPanelsTransition,
      ...props
    },
    ref,
  ) {
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const [height, setHeight] = React.useState<number | "auto">("auto");

    React.useLayoutEffect(() => {
      if (mode !== "auto-height" || !contentRef.current) {
        return undefined;
      }

      const content = contentRef.current;
      const updateHeight = () => setHeight(content.offsetHeight);

      updateHeight();

      if (typeof ResizeObserver === "undefined") {
        return undefined;
      }

      const observer = new ResizeObserver(updateHeight);
      observer.observe(content);

      return () => observer.disconnect();
    }, [children, mode]);

    if (mode === "layout") {
      return (
        <motion.div
          ref={ref}
          layout
          className={className}
          transition={transition}
          {...props}
        >
          {children}
        </motion.div>
      );
    }

    return (
      <motion.div
        ref={ref}
        animate={{ height }}
        className={cn("overflow-hidden", className)}
        transition={transition}
        {...props}
      >
        <div ref={contentRef}>{children}</div>
      </motion.div>
    );
  },
);

const TabsPanel = React.forwardRef<HTMLDivElement, TabsPanelProps>(
  function TabsPanel(
    { className, transition = tabsPanelTransition, ...props },
    ref,
  ) {
    return (
      <BaseTabs.Panel
        ref={ref}
        render={(renderProps) => (
          <motion.div
            {...(renderProps as HTMLMotionProps<"div">)}
            animate={{ opacity: 1, y: 0 }}
            className={cn("outline-none", className)}
            initial={{ opacity: 0, y: 4 }}
            transition={transition}
          />
        )}
        {...props}
      />
    );
  },
);

export { Tabs, TabsList, TabsPanel, TabsPanels, TabsTab };
