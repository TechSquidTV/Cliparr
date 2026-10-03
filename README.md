# Cliparr

<div align="center">
  <img src="./.github/img/logo.png" alt="Cliparr logo" width="150" />
  <h3>Clip your personal media.</h3>
  <p>
    <img src="https://img.shields.io/badge/Support-Plex-e5a00d?style=for-the-badge&logo=plex&logoColor=white" alt="Plex support" />
    <img src="https://img.shields.io/badge/Support-Jellyfin-00a4dc?style=for-the-badge&logo=jellyfin&logoColor=white" alt="Jellyfin support" />
    <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT" />
  </p>
</div>

Self-hosted clipping for Plex, Jellyfin, and local files. Trim video, add subtitles, and export video, audio, or GIFs in your browser.

[Documentation](https://cliparr.dev/docs)

<img src="./apps/www/src/assets/screenshot.webp" alt="Cliparr editor showing a video preview, timeline clip selection, and subtitle controls." width="100%" />

## Features

<!-- CLIPARR_DOCS_SYNC:features:start -->

- **Live session discovery**: Follow playback automatically from connected <a href="https://cliparr.dev/docs/providers">Plex and Jellyfin servers</a>.
- **Open local videos**: Clip <a href="https://cliparr.dev/docs/local-videos">local files</a> without uploading them. Direct media URLs require provider sign-in.
- **Timeline editing**: Trim, zoom, and fine-tune your clip range with a familiar non-linear editor.
- **Video, audio, and GIF export**: Choose video or audio-only formats, or make a GIF. <a href="https://cliparr.dev/docs/export-settings">Exports run in your browser</a>.
- **Metadata included**: Keep source details, artwork, and clip timing in supported <a href="https://cliparr.dev/docs/export-metadata">video and audio containers</a>.
- **Subtitle authoring**: Create your own captions or import subtitles, then <a href="https://cliparr.dev/docs/subtitle-burn-in">style and burn subtitles</a> into your clip.

<!-- CLIPARR_DOCS_SYNC:features:end -->

## Quick start

Replace `APP_KEY` with a random secret of at least 32 characters; for example, generate one with `openssl rand -base64 32`. Keep the secret and data volume across updates. Changing `APP_KEY` requires reconnecting your media servers.

<!-- CLIPARR_DOCS_SYNC:docker-quick-start:start -->

```bash
docker run -d \
  --name cliparr \
  -p 7171:7171 \
  -e APP_KEY="your-32-char-stable-random-secret" \
  -v cliparr-data:/data \
  ghcr.io/techsquidtv/cliparr:latest
```

<details>
<summary>PowerShell</summary>

```powershell
docker run -d `
  --name cliparr `
  -p 7171:7171 `
  -e APP_KEY="your-32-char-stable-random-secret" `
  -v cliparr-data:/data `
  ghcr.io/techsquidtv/cliparr:latest
```

Use Docker with Linux containers.

</details>
<!-- CLIPARR_DOCS_SYNC:docker-quick-start:end -->

Open **http://localhost:7171**, then connect a media server or choose **Open Video** for a local file. Access from other devices requires [HTTPS for editing](https://cliparr.dev/docs/configuration#https-and-browser-apis).

For Docker Compose and installation details, see [Getting started](https://cliparr.dev/docs/getting-started).

## Guides

- [Provider setup and account requirements](https://cliparr.dev/docs/providers)
- [Reverse proxies](https://cliparr.dev/docs/configuration#reverse-proxies) and [access control](https://cliparr.dev/docs/access-control)
- [Browser support](https://cliparr.dev/docs/browser-support) and [editor shortcuts](https://cliparr.dev/docs/editor-shortcuts)
- [Environment variables](https://cliparr.dev/docs/configuration) and [logging](https://cliparr.dev/docs/logging)

## Development

See [Contributing](.github/CONTRIBUTING.md) for local setup, the Docker dev stack, validation, and release procedures.

## License

[MIT](LICENSE).
