/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare module "*.avif" {
  const metadata: import("astro").ImageMetadata;
  export default metadata;
}

declare module "*.jpg" {
  const metadata: import("astro").ImageMetadata;
  export default metadata;
}

declare module "*.png" {
  const metadata: import("astro").ImageMetadata;
  export default metadata;
}

declare module "*.webp" {
  const metadata: import("astro").ImageMetadata;
  export default metadata;
}
