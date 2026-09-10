import { useRef, type ComponentProps } from "react";
import { DialogFooter, DialogWindow } from "@/components/ui/dialog";
import {
  primaryButtonClasses,
  secondaryButtonClasses,
} from "@/components/ui/control-styles";

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  finalFocus,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
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
      <DialogFooter className="p-4">
        <button
          ref={cancelReference}
          type="button"
          className={`${secondaryButtonClasses} min-h-11 sm:min-h-9`}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${primaryButtonClasses} min-h-11 sm:min-h-9`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </DialogFooter>
    </DialogWindow>
  );
}
