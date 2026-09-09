import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import {
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type Transition,
} from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utilities";

type TabsRootProperties = React.ComponentProps<typeof BaseTabs.Root>;
type TabsListProperties = Omit<
  React.ComponentProps<typeof BaseTabs.List>,
  "className" | "ref"
> & {
  className?: string;
  indicatorClassName?: string;
  springIndicator?: boolean;
};
type TabsTabProperties = Omit<
  React.ComponentProps<typeof BaseTabs.Tab>,
  "className" | "ref"
> & {
  className?: string;
};
type TabsPanelsProperties = Omit<
  HTMLMotionProps<"div">,
  "children" | "transition"
> & {
  children: React.ReactNode;
  mode?: "auto-height" | "layout" | "static";
  transition?: Transition;
};
type TabsPanelProperties = Omit<
  React.ComponentProps<typeof BaseTabs.Panel>,
  "className" | "ref" | "render"
> & {
  className?: string;
  transition?: Transition;
  animated?: boolean;
};

const SpringIndicatorContext = React.createContext<{
  id: string;
  className?: string;
} | null>(null);
const indicatorTransition = {
  type: "spring",
  stiffness: 170,
  damping: 24,
  mass: 1.2,
} as const;

const tabsPanelsTransition = {
  type: "spring",
  stiffness: 200,
  damping: 25,
} as const;

const tabsPanelTransition = {
  duration: 0.28,
  ease: "easeInOut",
} as const;

const Tabs = React.forwardRef<HTMLDivElement, TabsRootProperties>(function Tabs(
  { className, ...props },
  ref,
) {
  return (
    <BaseTabs.Root ref={ref} className={cn("min-w-0", className)} {...props} />
  );
});

const TabsList = React.forwardRef<HTMLDivElement, TabsListProperties>(
  function TabsList(
    {
      className,
      indicatorClassName,
      springIndicator = false,
      children,
      ...props
    },
    ref,
  ) {
    const id = React.useId();
    const indicator = React.useMemo(
      () => (springIndicator ? { id, className: indicatorClassName } : null),
      [id, indicatorClassName, springIndicator],
    );
    return (
      <SpringIndicatorContext.Provider value={indicator}>
        <BaseTabs.List
          ref={ref}
          className={cn(
            "relative isolate inline-flex overflow-hidden rounded-md border border-border bg-background p-1",
            className,
          )}
          {...props}
        >
          {!springIndicator && (
            <BaseTabs.Indicator
              renderBeforeHydration
              className={cn(
                "absolute z-0 rounded-[var(--radius-control)] bg-primary transition-[top,left,width,height] duration-200 ease-out",
                "top-[var(--active-tab-top)] left-[var(--active-tab-left)] h-[var(--active-tab-height)] w-[var(--active-tab-width)]",
                indicatorClassName,
              )}
            />
          )}
          {children}
        </BaseTabs.List>
      </SpringIndicatorContext.Provider>
    );
  },
);

const TabsTab = React.forwardRef<HTMLElement, TabsTabProperties>(
  function TabsTab({ className, children, render, ...props }, ref) {
    const indicator = React.useContext(SpringIndicatorContext);
    const reducedMotion = useReducedMotion();
    return (
      <BaseTabs.Tab
        ref={ref}
        className={cn(
          "relative z-10 inline-flex h-8 items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 text-xs font-semibold uppercase tracking-[var(--tracking-caps-sm)] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none data-[active]:text-primary-foreground data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55",
          className,
        )}
        render={
          indicator
            ? (tabProperties, state) => (
                <button {...tabProperties}>
                  {state.active && (
                    <motion.span
                      aria-hidden="true"
                      layoutId={reducedMotion ? undefined : indicator.id}
                      initial={false}
                      transition={
                        reducedMotion ? { duration: 0 } : indicatorTransition
                      }
                      className={cn(
                        "pointer-events-none absolute inset-0 rounded-[var(--radius-control)] bg-primary",
                        indicator.className,
                      )}
                    />
                  )}
                  <span className="relative z-10 inline-flex min-w-0 items-center justify-center gap-2">
                    {children}
                  </span>
                </button>
              )
            : render
        }
        {...props}
      >
        {children}
      </BaseTabs.Tab>
    );
  },
);

const TabsPanels = React.forwardRef<HTMLDivElement, TabsPanelsProperties>(
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
    const contentReference = React.useRef<HTMLDivElement | null>(null);
    const [height, setHeight] = React.useState<number | "auto">("auto");

    React.useLayoutEffect(() => {
      if (mode !== "auto-height" || !contentReference.current) {
        return;
      }

      const content = contentReference.current;
      const updateHeight = () => setHeight(content.offsetHeight);

      updateHeight();

      if (typeof ResizeObserver === "undefined") {
        return;
      }

      const observer = new ResizeObserver(updateHeight);
      observer.observe(content);

      return () => observer.disconnect();
    }, [children, mode]);

    if (mode === "static") {
      return (
        <motion.div ref={ref} className={className} {...props}>
          {children}
        </motion.div>
      );
    }

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
        <div ref={contentReference}>{children}</div>
      </motion.div>
    );
  },
);

const TabsPanel = React.forwardRef<HTMLDivElement, TabsPanelProperties>(
  function TabsPanel(
    { className, transition = tabsPanelTransition, animated = true, ...props },
    ref,
  ) {
    const reducedMotion = useReducedMotion();
    if (!animated || reducedMotion) {
      return (
        <BaseTabs.Panel
          ref={ref}
          className={cn("outline-none", className)}
          {...props}
        />
      );
    }
    return (
      <BaseTabs.Panel
        ref={ref}
        render={(renderProperties) => (
          <motion.div
            {...(renderProperties as HTMLMotionProps<"div">)}
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
