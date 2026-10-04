import { LoaderCircle } from "lucide-react";
import { cn } from "#/lib/utilities";

export function Spinner({ className }: { className?: string } = {}) {
  return (
    <LoaderCircle
      data-slot="spinner"
      aria-hidden="true"
      className={cn(
        "h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none",
        className,
      )}
    />
  );
}
