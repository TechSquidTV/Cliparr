import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { motion, type HTMLMotionProps, type Transition } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utilities";

type BaseSwitchRootProperties = React.ComponentProps<typeof BaseSwitch.Root>;

type SwitchVariant = "default" | "editor";

interface SwitchProperties extends Omit<
  BaseSwitchRootProperties,
  "children" | "className" | "defaultChecked" | "ref" | "render" | "style"
> {
  className?: string;
  defaultChecked?: boolean;
  endIcon?: React.ReactElement;
  pressedWidth?: number;
  startIcon?: React.ReactElement;
  style?: React.CSSProperties;
  thumbClassName?: string;
  thumbIcon?: React.ReactElement;
  transition?: Transition;
  variant?: SwitchVariant;
}

const SWITCH_WIDTH = 36;
const SWITCH_INSET = 4;
const THUMB_WIDTH = 12;

const switchTransition = {
  type: "spring",
  stiffness: 430,
  damping: 30,
  mass: 0.7,
} as const;

const rootVariantClasses: Record<SwitchVariant, string> = {
  default:
    "border-input bg-input text-muted-foreground focus-visible:ring-ring/40 data-[checked]:border-primary/60 data-[checked]:bg-primary/30",
  editor:
    "border-editor-border bg-editor-control text-muted-foreground focus-visible:ring-editor-accent/35 data-[checked]:border-editor-accent/55 data-[checked]:bg-editor-control-active",
};

const thumbVariantClasses: Record<SwitchVariant, string> = {
  default: "bg-muted-foreground text-background data-[checked]:bg-primary",
  editor:
    "bg-muted-foreground text-editor-panel data-[checked]:bg-editor-accent",
};

const Switch = React.forwardRef<HTMLElement, SwitchProperties>(function Switch(
  {
    checked,
    className,
    defaultChecked = false,
    disabled = false,
    endIcon,
    onBlur,
    onCheckedChange,
    onKeyDown,
    onKeyUp,
    onPointerCancel,
    onPointerDown,
    onPointerLeave,
    onPointerUp,
    pressedWidth = 19,
    readOnly = false,
    startIcon,
    style,
    thumbClassName,
    thumbIcon,
    transition = switchTransition,
    variant = "default",
    ...props
  },
  ref,
) {
  const isControlled = checked !== undefined;
  const [uncontrolledChecked, setUncontrolledChecked] =
    React.useState(defaultChecked);
  const [pressed, setPressed] = React.useState(false);
  const currentChecked = isControlled ? checked : uncontrolledChecked;
  const activeThumbWidth =
    pressed && !disabled && !readOnly
      ? Math.min(Math.max(pressedWidth, THUMB_WIDTH), 24)
      : THUMB_WIDTH;
  const thumbX = currentChecked
    ? SWITCH_WIDTH - SWITCH_INSET * 2 - activeThumbWidth
    : 0;

  const handleCheckedChange = React.useCallback<
    NonNullable<BaseSwitchRootProperties["onCheckedChange"]>
  >(
    (nextChecked, eventDetails) => {
      onCheckedChange?.(nextChecked, eventDetails);

      if (!isControlled && !eventDetails.isCanceled) {
        setUncontrolledChecked(nextChecked);
      }
    },
    [isControlled, onCheckedChange],
  );

  const shouldPress = !disabled && !readOnly;

  const handlePointerDown = React.useCallback<
    NonNullable<BaseSwitchRootProperties["onPointerDown"]>
  >(
    (event) => {
      onPointerDown?.(event);

      if (!event.defaultPrevented && shouldPress) {
        setPressed(true);
      }
    },
    [onPointerDown, shouldPress],
  );

  const handlePointerUp = React.useCallback<
    NonNullable<BaseSwitchRootProperties["onPointerUp"]>
  >(
    (event) => {
      onPointerUp?.(event);
      setPressed(false);
    },
    [onPointerUp],
  );

  const handlePointerLeave = React.useCallback<
    NonNullable<BaseSwitchRootProperties["onPointerLeave"]>
  >(
    (event) => {
      onPointerLeave?.(event);
      setPressed(false);
    },
    [onPointerLeave],
  );

  const handlePointerCancel = React.useCallback<
    NonNullable<BaseSwitchRootProperties["onPointerCancel"]>
  >(
    (event) => {
      onPointerCancel?.(event);
      setPressed(false);
    },
    [onPointerCancel],
  );

  const handleKeyDown = React.useCallback<
    NonNullable<BaseSwitchRootProperties["onKeyDown"]>
  >(
    (event) => {
      onKeyDown?.(event);

      if (
        !event.defaultPrevented &&
        shouldPress &&
        (event.key === " " || event.key === "Enter")
      ) {
        setPressed(true);
      }
    },
    [onKeyDown, shouldPress],
  );

  const handleKeyUp = React.useCallback<
    NonNullable<BaseSwitchRootProperties["onKeyUp"]>
  >(
    (event) => {
      onKeyUp?.(event);
      setPressed(false);
    },
    [onKeyUp],
  );

  const handleBlur = React.useCallback<
    NonNullable<BaseSwitchRootProperties["onBlur"]>
  >(
    (event) => {
      onBlur?.(event);
      setPressed(false);
    },
    [onBlur],
  );

  return (
    <BaseSwitch.Root
      checked={currentChecked}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-55",
        rootVariantClasses[variant],
        className,
      )}
      disabled={disabled}
      onBlur={handleBlur}
      onCheckedChange={handleCheckedChange}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerLeave={handlePointerLeave}
      onPointerUp={handlePointerUp}
      readOnly={readOnly}
      ref={ref}
      style={style}
      {...props}
    >
      {startIcon ? (
        <span className="pointer-events-none absolute left-1.5 flex h-2.5 w-2.5 items-center justify-center opacity-75 [&_svg]:h-2.5 [&_svg]:w-2.5">
          {startIcon}
        </span>
      ) : null}
      {endIcon ? (
        <span className="pointer-events-none absolute right-1.5 flex h-2.5 w-2.5 items-center justify-center opacity-75 [&_svg]:h-2.5 [&_svg]:w-2.5">
          {endIcon}
        </span>
      ) : null}
      <BaseSwitch.Thumb
        render={(renderProperties) => (
          <motion.span
            {...(renderProperties as HTMLMotionProps<"span">)}
            animate={{ width: activeThumbWidth, x: thumbX }}
            className={cn(
              "pointer-events-none absolute left-1 top-1/2 flex h-3 -translate-y-1/2 items-center justify-center rounded-full transition-colors [&_svg]:h-2.5 [&_svg]:w-2.5",
              thumbVariantClasses[variant],
              thumbClassName,
            )}
            transition={transition}
          >
            {thumbIcon}
          </motion.span>
        )}
      />
    </BaseSwitch.Root>
  );
});

export { Switch };
