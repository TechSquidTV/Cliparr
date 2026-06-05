import { ExternalLink, Globe, LogOut, Menu } from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import type { LatestReleaseInfo } from "@/api/cliparrClient";

export const CLIPARR_WEBSITE_URL = "https://cliparr.dev/";
export const CLIPARR_GITHUB_URL = "https://github.com/TechSquidTV/Cliparr";

export function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 98 96"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z" />
    </svg>
  );
}

export function DashboardMobileMenu({
  appVersion,
  latestRelease,
  onDisconnect,
}: {
  appVersion: string;
  latestRelease: LatestReleaseInfo | null;
  onDisconnect: () => Promise<void> | void;
}) {
  const menuItemClassName =
    "flex min-h-14 w-full items-center justify-between gap-3 px-4 text-base font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none";
  const iconClassName =
    "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground";

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <button
          type="button"
          aria-label="Open dashboard menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </DrawerTrigger>
      <DrawerContent className="border-border bg-background/95 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden">
        <DrawerTitle className="sr-only">Cliparr Menu</DrawerTitle>
        <DrawerDescription className="sr-only">
          Dashboard menu
        </DrawerDescription>
        <div className="px-4 pt-5">
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <DrawerClose asChild>
              <a
                href={CLIPARR_WEBSITE_URL}
                target="_blank"
                rel="noreferrer"
                className={menuItemClassName}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className={iconClassName}>
                    <Globe className="h-4 w-4" />
                  </span>
                  <span className="truncate">Website</span>
                </span>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
              </a>
            </DrawerClose>
            <div className="mx-4 h-px bg-border" />
            <DrawerClose asChild>
              <a
                href={CLIPARR_GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className={menuItemClassName}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className={iconClassName}>
                    <GithubIcon className="h-4 w-4" />
                  </span>
                  <span className="truncate">GitHub</span>
                </span>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
              </a>
            </DrawerClose>
          </div>

          <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
            <DrawerClose asChild>
              <button
                type="button"
                onClick={() => void onDisconnect()}
                className={menuItemClassName}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className={iconClassName}>
                    <LogOut className="h-4 w-4" />
                  </span>
                  <span className="truncate">Disconnect</span>
                </span>
              </button>
            </DrawerClose>
          </div>

          {appVersion && (
            <DrawerFooter className="border-t-0 px-4 pt-4 pb-0 text-center text-xs text-muted-foreground">
              {latestRelease ? (
                <DrawerClose asChild>
                  <a
                    href={latestRelease.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg border border-primary/35 bg-primary/10 px-3 py-2 text-primary transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none"
                    data-dashboard-mobile-update-available
                  >
                    <span className="font-mono text-muted-foreground">
                      Cliparr {appVersion}
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold">
                      {latestRelease.tagName} available
                      <ExternalLink className="h-3.5 w-3.5" />
                    </span>
                  </a>
                </DrawerClose>
              ) : (
                <span className="font-mono">Cliparr {appVersion}</span>
              )}
            </DrawerFooter>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
