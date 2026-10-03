import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utilities";

export function EmptyState({
  children,
  className,
  description,
  icon,
  title,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  description: ReactNode;
  icon?: ReactNode;
  title?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-card-foreground",
        className,
      )}
      {...props}
    >
      {icon && (
        <div
          className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-muted-foreground"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
      {children}
    </div>
  );
}
