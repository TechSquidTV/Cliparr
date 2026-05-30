# Cliparr

<div align="center">
  <img src="./.github/img/logo.png" alt="Cliparr Logo" width="150px" />
 <h3>Instant media clipper for your personal media server.</h3>
  <p>
    <img src="https://img.shields.io/badge/Support-Plex-e5a00d?style=for-the-badge&logo=plex&logoColor=white" alt="Plex Support" />
    <img src="https://img.shields.io/badge/Support-Jellyfin-00a4dc?style=for-the-badge&logo=jellyfin&logoColor=white" alt="Jellyfin Support" />
    <img src="https://img.shields.io/github/license/techsquidtv/cliparr?style=for-the-badge" alt="License" />
  </p>
</div>

---

**Cliparr** is a streamlined media clipper that allows you to quickly create and download clips from the media currently playing on your Plex or Jellyfin server, or from a local video file opened directly in your browser.

<video src="https://github.com/user-attachments/assets/4f9d5f6b-8016-4068-b375-f050d57de534" width="100%" alt="Cliparr Demo">
</video>

## Features

<!-- CLIPARR_DOCS_SYNC:features:start -->

- **Instant session discovery**: Automatically loads your media player's currently playing file.
- **Open local videos**: Open a local file or direct media URL before or after connecting a provider.
- **Intuitive timeline editor**: Familiar editing controls for choosing the exact clip range.
- **Browser transcoding**: Powered by Mediabunny, video is transcoded in your browser.
- **Metadata included**: Exports can include season, episode, and timing metadata from your source.
- **Subtitle burn-in**: Burn in supported subtitles with customizable styling and local font support in Chromium.
<!-- CLIPARR_DOCS_SYNC:features:end -->

## Getting Started

### Quick Start with Docker

<!-- CLIPARR_DOCS_SYNC:docker-quick-start:start -->

The fastest way to get Cliparr running is via the GitHub Container Registry.

```bash
docker run -d \
  --name cliparr \
  -p 3000:3000 \
  -e APP_KEY="your-32-char-stable-random-secret" \
  -v cliparr-data:/data \
  ghcr.io/techsquidtv/cliparr:latest
```

> [!IMPORTANT]
> **Stable APP_KEY required**: Cliparr uses APP_KEY to encrypt provider credentials at rest. Use a stable random secret at least 32 characters long. If you change it later, you will need to re-authenticate your media servers.

> [!IMPORTANT]
> **Use HTTPS for editing**: Cliparr's editor uses browser WebCodecs. Supporting browsers require a secure context, so use HTTPS through a reverse proxy or open Cliparr on localhost or 127.0.0.1.

<!-- CLIPARR_DOCS_SYNC:docker-quick-start:end -->

### Local Videos

Use **Open Video** on the connect screen or dashboard to open a file from your device or a direct media URL. Files are read by the browser with Mediabunny and are not uploaded to the Cliparr server. Browsers that support persistent file handles can reopen the selected file after refresh once you grant permission again; other file input and drag-and-drop sessions stay available only while the tab is open.

URL media streams through Cliparr's media proxy. The URL must use HTTP or HTTPS, be reachable from the Cliparr server, and not point at a blocked internal address. For smooth seeking and clipping, use URLs that support byte-range requests. HLS `.m3u8` URLs can be opened when Cliparr can fetch the playlist and its segment URLs.

### Using Docker Compose

For a persistent setup, we recommend using Docker Compose:

```yaml
services:
  cliparr:
    image: ghcr.io/techsquidtv/cliparr:latest
    container_name: cliparr
    ports:
      - "3000:3000"
    environment:
      - APP_KEY=replace-this-with-a-32-character-secure-random-string
    volumes:
      - cliparr-data:/data
    restart: unless-stopped

volumes:
  cliparr-data:
```

## Configuration

<!-- CLIPARR_DOCS_SYNC:configuration:start -->

| Variable                               | Description                                                                                         | Default |
| :------------------------------------- | :-------------------------------------------------------------------------------------------------- | :------ |
| `APP_KEY`                              | Required secret for credential encryption. Must be at least 32 characters long.                     | `-`     |
| `PORT`                                 | Internal port for the Express server.                                                               | `3000`  |
| `CLIPARR_DATA_DIR`                     | Directory for SQLite storage.                                                                       | `/data` |
| `CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS` | Allow Jellyfin URLs that resolve to localhost or loopback. Use only for trusted self-hosted setups. | `false` |

<!-- CLIPARR_DOCS_SYNC:configuration:end -->

When running behind a reverse proxy, preserve the `Host` header and pass `X-Forwarded-Proto`. Cliparr trusts loopback, link-local, and private-LAN proxy ranges directly in the app, so typical Caddy/Nginx/Traefik setups on the same network do not need extra app configuration. Caddy already forwards the needed headers.

## Development

We welcome contributions! To get started with a local development environment:

1. **Clone**: `git clone https://github.com/techsquidtv/cliparr.git`
2. **Setup**: `cp .env.example .env` (and fill in `APP_KEY`)
3. **Install**: `pnpm install`
4. **Run**: `pnpm dev`

The optional Docker dev stack (`docker-compose.dev.yml`) seeds Plex and Jellyfin with Sintel, a Blender open movie with embedded subtitle tracks. Run `pnpm docker:dev:build` after Dockerfile or dependency changes, then `pnpm docker:dev:up` to start the stack. The seed is skipped when `CI=true` or `GITHUB_ACTIONS=true` so CI jobs do not download the large test movie. If you previously used the old Big Buck Bunny seed, recreate the `cliparr-dev-media`, `plex-config`, and `jellyfin-config` Docker volumes to force a clean library scan.

See [CONTRIBUTING.md](CONTRIBUTING.md) for more detailed guidance.

## License

Cliparr is released under the [MIT License](LICENSE).
