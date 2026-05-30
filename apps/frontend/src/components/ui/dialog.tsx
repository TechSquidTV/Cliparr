import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import {
  AnimatePresence,
  motion,
  type HTMLMotionProps,
  type Transition,
} from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

type DialogRootProps = React.ComponentProps<typeof BaseDialog.Root>;
type DialogPortalProps = Omit<
  React.ComponentProps<typeof BaseDialog.Portal>,
  "keepMounted"
> & {
  className?: string;
};
type DialogBackdropProps = Omit<
  React.ComponentProps<typeof BaseDialog.Backdrop>,
  "onClick" | "render"
> & {
  onClick?: () => void;
  transition?: Transition;
};
type DialogPopupProps = Omit<
  React.ComponentProps<typeof BaseDialog.Popup>,
  "render"
> & {
  showCloseButton?: boolean;
  from?: "top" | "bottom" | "left" | "right";
  transition?: Transition;
};

type DialogWindowProps = Omit<
  DialogRootProps,
  "children" | "disablePointerDismissal" | "onOpenChange" | "open"
> & {
  open: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
  closeLabel?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  ariaLabel?: string;
  children: React.ReactNode;
  initialFocus?: DialogPopupProps["initialFocus"];
  finalFocus?: DialogPopupProps["finalFocus"];
  from?: DialogPopupProps["from"];
  portalClassName?: string;
  popupClassName?: string;
  headerClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
};

type DialogRootActions = {
  close: () => void;
  unmount: () => void;
};

interface DialogAnimationContextValue {
  actionsRef: React.RefObject<DialogRootActions | null>;
  disablePointerDismissal: boolean;
  open: boolean;
}

const DialogAnimationContext =
  React.createContext<DialogAnimationContextValue | null>(null);

const backdropTransition = { duration: 0.2, ease: "easeInOut" } as const;
const popupTransition = {
  type: "spring",
  stiffness: 150,
  damping: 25,
} as const;
const titleClasses =
  "text-sm font-semibold uppercase tracking-[var(--tracking-caps-md)] text-foreground";
const descriptionClasses = "text-xs text-muted-foreground";
const iconCloseButtonClasses =
  "flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60";

function useDialogAnimationContext(componentName: string) {
  const context = React.useContext(DialogAnimationContext);

  if (!context) {
    throw new Error(`${componentName} must be used within Dialog.`);
  }

  return context;
}

function Dialog({
  actionsRef,
  defaultOpen = false,
  disablePointerDismissal = false,
  onOpenChange,
  open,
  ...props
}: DialogRootProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const internalActionsRef = React.useRef<DialogRootActions | null>(null);
  const resolvedActionsRef = (actionsRef ??
    internalActionsRef) as React.RefObject<DialogRootActions | null>;
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : uncontrolledOpen;

  const handleOpenChange = React.useCallback<
    NonNullable<DialogRootProps["onOpenChange"]>
  >(
    (nextOpen, eventDetails) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }

      onOpenChange?.(nextOpen, eventDetails);
    },
    [isControlled, onOpenChange],
  );

  return (
    <DialogAnimationContext.Provider
      value={{
        actionsRef: resolvedActionsRef,
        disablePointerDismissal,
        open: currentOpen,
      }}
    >
      <BaseDialog.Root
        actionsRef={resolvedActionsRef}
        disablePointerDismissal={disablePointerDismissal}
        open={currentOpen}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </DialogAnimationContext.Provider>
  );
}

function DialogPortal({ children, className, ...props }: DialogPortalProps) {
  const { open } = useDialogAnimationContext("DialogPortal");
  const content = (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-50 grid place-items-center p-4",
        className,
      )}
    >
      {children}
    </div>
  );

  if (typeof document === "undefined") {
    return open ? content : null;
  }

  return (
    <AnimatePresence>
      {open ? (
        <BaseDialog.Portal keepMounted {...props}>
          {content}
        </BaseDialog.Portal>
      ) : null}
    </AnimatePresence>
  );
}

function DialogBackdrop({
  className,
  onClick,
  transition = backdropTransition,
  ...props
}: DialogBackdropProps) {
  const { actionsRef, disablePointerDismissal } =
    useDialogAnimationContext("DialogBackdrop");
  const backdropClassName = cn(
    "pointer-events-auto fixed inset-0 bg-foreground/40 backdrop-blur-sm",
    className,
  );

  if (typeof document === "undefined") {
    return <div className={backdropClassName} />;
  }

  return (
    <BaseDialog.Backdrop
      {...props}
      render={(renderProps) => (
        <motion.div
          {...(renderProps as HTMLMotionProps<"div">)}
          className={backdropClassName}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => {
            renderProps.onClick?.(event);
            if (disablePointerDismissal) {
              return;
            }

            if (onClick) {
              onClick();
            } else {
              actionsRef.current?.close();
            }
          }}
          transition={transition}
        />
      )}
    />
  );
}

function DialogPopup({
  children,
  className,
  finalFocus,
  from = "top",
  initialFocus,
  showCloseButton = true,
  transition = popupTransition,
  ...props
}: DialogPopupProps) {
  const { actionsRef, open } = useDialogAnimationContext("DialogPopup");
  const fromOffset = getPopupOffset(from);
  const popupClassName = cn(
    "pointer-events-auto relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl outline-none",
    className,
  );
  const popupChildren = (
    <>
      {showCloseButton ? (
        <DialogClose className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogClose>
      ) : null}
      {children}
    </>
  );

  if (typeof document === "undefined") {
    const { style: _style, ...ssrProps } = props;

    return (
      <div
        {...(ssrProps as React.HTMLAttributes<HTMLDivElement>)}
        role="dialog"
        aria-modal="true"
        className={popupClassName}
      >
        {popupChildren}
      </div>
    );
  }

  return (
    <BaseDialog.Popup
      {...props}
      finalFocus={finalFocus}
      initialFocus={initialFocus}
      render={(renderProps) => (
        <motion.div
          {...(renderProps as HTMLMotionProps<"div">)}
          className={popupClassName}
          initial={{ opacity: 0, scale: 0.97, ...fromOffset }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, ...fromOffset }}
          transition={transition}
          onAnimationComplete={() => {
            if (!open) {
              actionsRef.current?.unmount();
            }
          }}
        />
      )}
    >
      {popupChildren}
    </BaseDialog.Popup>
  );
}

function DialogClose(props: React.ComponentProps<typeof BaseDialog.Close>) {
  return <BaseDialog.Close {...props} />;
}

function DialogWindow({
  ariaLabel,
  children,
  closeDisabled = false,
  closeLabel = "Close dialog",
  description,
  descriptionClassName,
  finalFocus,
  from,
  headerClassName,
  initialFocus,
  onClose,
  open,
  portalClassName,
  popupClassName,
  title,
  titleClassName,
  ...props
}: DialogWindowProps) {
  const hasHeader = Boolean(title || description);

  return (
    <Dialog
      open={open}
      disablePointerDismissal={closeDisabled}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !closeDisabled) {
          onClose();
        }
      }}
      {...props}
    >
      <DialogPortal className={portalClassName}>
        <DialogBackdrop
          onClick={() => {
            if (!closeDisabled) {
              onClose();
            }
          }}
        />
        <DialogPopup
          showCloseButton={false}
          initialFocus={initialFocus}
          finalFocus={finalFocus}
          from={from}
          aria-label={ariaLabel}
          className={popupClassName}
        >
          {hasHeader ? (
            <DialogHeader
              className={cn(
                "flex-row items-start justify-between gap-3 border-b border-border px-4 py-3",
                headerClassName,
              )}
            >
              <div className="space-y-1">
                {title ? (
                  <DialogTitle className={cn(titleClasses, titleClassName)}>
                    {title}
                  </DialogTitle>
                ) : null}
                {description ? (
                  <DialogDescription
                    className={cn(descriptionClasses, descriptionClassName)}
                  >
                    {description}
                  </DialogDescription>
                ) : null}
              </div>
              <DialogClose
                disabled={closeDisabled}
                aria-label={closeLabel}
                className={iconCloseButtonClasses}
              >
                <X className="h-4 w-4" />
              </DialogClose>
            </DialogHeader>
          ) : null}
          {children}
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 text-center sm:text-left",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle(props: React.ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title {...props} />;
}

function DialogDescription(
  props: React.ComponentProps<typeof BaseDialog.Description>,
) {
  return <BaseDialog.Description {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function getPopupOffset(from: NonNullable<DialogPopupProps["from"]>) {
  switch (from) {
    case "bottom":
      return { y: 18 };
    case "left":
      return { x: -18 };
    case "right":
      return { x: 18 };
    case "top":
    default:
      return { y: -18 };
  }
}

export { DialogClose, DialogFooter, DialogWindow };
