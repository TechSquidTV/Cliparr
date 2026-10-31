import { type ComponentProps, useRef } from "react";

import { buttonClassName } from "#/components/ui/control-styles";
import { DialogFooter, DialogWindow } from "#/components/ui/dialog";

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  finalFocus,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  finalFocus?: ComponentProps<typeof DialogWindow>["finalFocus"];
}) {
  const cancelReference = useRef<HTMLButtonElement>(null);

  return (
    <DialogWindow
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      closeLabel="Cancel confirmation"
      initialFocus={cancelReference}
      finalFocus={finalFocus}
    >
      <DialogFooter>
        <button
          ref={cancelReference}
          type="button"
          className={`${buttonClassName({ tone: "secondary" })} min-h-11 sm:min-h-9`}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`${buttonClassName()} min-h-11 sm:min-h-9`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </DialogFooter>
    </DialogWindow>
  );
}
