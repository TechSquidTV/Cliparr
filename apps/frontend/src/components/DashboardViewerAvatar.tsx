import { useState } from "react";
import { cn } from "@/lib/utilities";

type DashboardViewerAvatarSize = "xs" | "sm" | "md";

function dashboardViewerAvatarSizeClass(size: DashboardViewerAvatarSize) {
  if (size === "xs") {
    return "h-6 w-6 text-[11px]";
  }

  if (size === "sm") {
    return "h-8 w-8 text-sm";
  }

  return "h-12 w-12 text-lg";
}

function dashboardViewerAvatarImageSize(size: DashboardViewerAvatarSize) {
  if (size === "xs") {
    return 24;
  }

  if (size === "sm") {
    return 32;
  }

  return 48;
}

export function DashboardViewerAvatar({
  avatarUrl,
  name,
  size = "md",
}: {
  avatarUrl?: string;
  name: string;
  size?: DashboardViewerAvatarSize;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const label = name.trim().charAt(0).toUpperCase() || "?";
  const sizeClass = dashboardViewerAvatarSizeClass(size);
  const imageSize = dashboardViewerAvatarImageSize(size);

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 font-semibold text-primary",
        sizeClass,
      )}
    >
      {avatarUrl && !imageFailed ? (
        <img
          src={avatarUrl}
          alt={name}
          className="h-full w-full object-cover"
          width={imageSize}
          height={imageSize}
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        label
      )}
    </div>
  );
}
