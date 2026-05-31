---
name: cliparr-www-assets
description: Workflow for updating homepage marketing videos and static first-frame images. Includes ffmpeg and ImageMagick commands for extracting first frames and optimizing videos for web (MP4/H.264 and WebM/VP9) at specific resolutions for desktop and mobile.
---

# Cliparr Website Assets Workflow

Use this skill when you need to replace the preview videos or static screenshots on the Cliparr homepage (`apps/www`).

## Assets and Resolutions

| Asset Type  | Resolution | Image Path                                    | Video Paths                                                                         |
| :---------- | :--------- | :-------------------------------------------- | :---------------------------------------------------------------------------------- |
| **Desktop** | 1600x886   | `apps/www/src/assets/screenshot.webp`         | `apps/www/public/preview.mp4`, `apps/www/public/preview.webm`                       |
| **Mobile**  | 402x874    | `apps/www/src/assets/mobile-pwa-preview.webp` | `apps/www/public/mobile-pwa-preview.mp4`, `apps/www/public/mobile-pwa-preview.webm` |

## Preparation

1.  **Record Source:** Capture high-quality screen recordings at the target resolution or higher.
    - Ensure no mouse cursor is visible if possible.
    - Use a consistent theme (Cliparr dark theme is preferred).
    - Keep the recording focused and short (under 10 seconds).
2.  **Input Files:** Name your source files `desktop-source.mov` (or `.mp4`) and `mobile-source.mov` (or `.mp4`).

## Processing Workflow

### 1. Extract First Frame (Static Placeholder)

Extract the first frame as a PNG, then convert it to optimized WebP.

**Desktop:**

```bash
ffmpeg -i desktop-source.mov -frames:v 1 desktop-frame.png
magick desktop-frame.png -quality 72 apps/www/src/assets/screenshot.webp
rm desktop-frame.png
```

**Mobile:**

```bash
ffmpeg -i mobile-source.mov -frames:v 1 mobile-frame.png
magick mobile-frame.png -quality 72 apps/www/src/assets/mobile-pwa-preview.webp
rm mobile-frame.png
```

### 2. Optimize Videos for Web

Generate optimized MP4 and WebM versions.

#### Desktop (1600x886)

**MP4 (H.264):**

```bash
ffmpeg -i desktop-source.mov -vf "scale=1600:886" -c:v libx264 -crf 23 -preset slow -pix_fmt yuv420p -an apps/www/public/preview.mp4
```

**WebM (VP9):**

```bash
ffmpeg -i desktop-source.mov -vf "scale=1600:886" -c:v libvpx-vp9 -crf 30 -b:v 0 -deadline good -cpu-used 1 -an apps/www/public/preview.webm
```

#### Mobile (402x874)

**MP4 (H.264):**

```bash
ffmpeg -i mobile-source.mov -vf "scale=402:874" -c:v libx264 -crf 23 -preset slow -pix_fmt yuv420p -an apps/www/public/mobile-pwa-preview.mp4
```

**WebM (VP9):**

```bash
ffmpeg -i mobile-source.mov -vf "scale=402:874" -c:v libvpx-vp9 -crf 30 -b:v 0 -deadline good -cpu-used 1 -an apps/www/public/mobile-pwa-preview.webm
```

## Validation

1.  **Check File Sizes:** They should be relatively small (under 500KB for desktop, under 100KB for mobile).
    ```bash
    ls -lh apps/www/public/preview.* apps/www/public/mobile-pwa-preview.* apps/www/src/assets/*.webp
    ```
2.  **Run Preview:** Start the dev server and check the homepage.
    ```bash
    pnpm dev:web
    ```
3.  **Visual Check:**
    - Hover over the preview areas to ensure the videos play correctly and align with the static images.
    - Verify that the "reduced motion" check in `apps/www/src/pages/index.astro` still shows the static image.

## Integration

After updating the assets, ensure the `Picture` component in `apps/www/src/pages/index.astro` still has matching `width` and `height` attributes to avoid layout shifts.
