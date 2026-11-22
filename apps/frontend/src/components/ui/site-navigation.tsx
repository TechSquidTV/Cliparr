import type { ComponentProps } from "react";

import { cn } from "#/lib/cn";

export const siteNavigation = {
  docs: { href: "/docs", label: "Docs" },
  getStarted: { href: "/docs/getting-started", label: "Get started" },
};

const focusClasses =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function SiteBrand({ logo, name }: { logo: string; name: string }) {
  return (
    <a
      href="/"
      aria-label={`${name} home`}
      className={cn(
        focusClasses,
        "flex shrink-0 items-center gap-3 rounded-md",
      )}
    >
      <img src={logo} alt="" className="site-logo h-8 w-8 shrink-0" />
      <span className="hidden text-lg font-semibold min-[380px]:inline">
        {name}
      </span>
    </a>
  );
}

export function SiteNavLink({
  variant = "plain",
  layout = "desktop",
  className,
  ...props
}: ComponentProps<"a"> & {
  variant?: "plain" | "featured" | "primary";
  layout?: "desktop" | "mobile";
}) {
  return (
    <a
      {...props}
      className={cn(
        focusClasses,
        "text-sm transition-colors",
        layout === "mobile"
          ? "flex min-h-11 items-center rounded-lg px-3"
          : "inline-flex min-h-9 items-center rounded-full px-3 py-2",
        variant === "primary"
          ? "justify-center bg-foreground px-4 font-semibold text-background hover:bg-primary"
          : "justify-between font-medium hover:bg-accent hover:text-foreground",
        variant === "featured" &&
          "border border-border bg-card text-foreground",
        variant === "plain" && "text-muted-foreground",
        className,
      )}
    />
  );
}
