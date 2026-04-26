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

**Cliparr** is a streamlined media clipper that allows you to quickly create and download clips from the media currently playing on your Plex or Jellyfin server.

<video src="https://github.com/user-attachments/assets/4f9d5f6b-8016-4068-b375-f050d57de534" width="100%" alt="Cliparr Demo">
</video>


## Features

- **Instant Session Discovery**: Automatically loads your media player's currently playing file.
- **Intuitive Timeline Editor**: Familiar UI based on common video editing interfaces.
- **Local Transcoding**: Powered by [Mediabunny](https://mediabunny.dev/), video is transcoded in your browser.
- **Rich Metadata Tagging**: Clips are exported with full EXIF data, including Season, Episode numbers, and timing metadata.
- **Native Plex & Jellyfin Support**: Seamless integration with the most popular media server platforms.

## Getting Started

### Quick Start with Docker

The fastest way to get Cliparr running is via the GitHub Container Registry.

```bash
docker run -d \
  --name cliparr \
  -p 3000:3000 \
  -e APP_KEY="your-stable-random-secret" \
  -v cliparr-data:/data \
  ghcr.io/techsquidtv/cliparr:latest
```

> [!IMPORTANT]
> **Stable APP_KEY Required**: Cliparr uses `APP_KEY` to encrypt your provider credentials at rest. You **must** use a stable, random secret. If you change this key later, you will need to re-authenticate your media servers.

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
      - APP_KEY=replace-this-with-a-secure-random-string
    volumes:
      - cliparr-data:/data
    restart: unless-stopped

volumes:
  cliparr-data:
```

## Configuration

| Variable | Description | Default |
| :--- | :--- | :--- |
| `APP_KEY` | **Required** secret for credential encryption. | - |
| `PORT` | Internal port for the Express server. | `3000` |
| `CLIPARR_TRUST_PROXY` | Optional Express trust proxy setting. Use `1` behind one reverse proxy like Caddy. | unset |
| `CLIPARR_DATA_DIR` | Directory for SQLite storage. | `/data` |
| `CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS` | Allow Jellyfin URLs that resolve to `localhost`/loopback. Use only for trusted self-hosted setups. | `false` |

When running behind a reverse proxy, preserve the `Host` header, pass `X-Forwarded-Proto`, and set `CLIPARR_TRUST_PROXY=1` for a single proxy hop. Leave it unset when accessing Cliparr directly over localhost or a LAN IP. Caddy already forwards the needed headers.

## Development

We welcome contributions! To get started with a local development environment:

1. **Clone**: `git clone https://github.com/techsquidtv/cliparr.git`
2. **Setup**: `cp .env.example .env` (and fill in `APP_KEY`)
3. **Install**: `pnpm install`
4. **Run**: `pnpm dev`

See [CONTRIBUTING.md](CONTRIBUTING.md) for more detailed guidance.

## License

Cliparr is released under the [MIT License](LICENSE).
