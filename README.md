# Cliparr

Vibe coded Plex clipper for pulling quick MP4s out of whatever is currently playing.

Cliparr connects to Plex, finds active playback sessions, lets you mark a clip range on a timeline, previews the original media in the browser, and exports an MP4 without setting up a heavyweight editing pipeline.

Built with [Mediabunny](https://mediabunny.dev/) and [`react-timeline-editor`](https://github.com/xzdarcy/react-timeline-editor).

## What It Does

- Signs in with Plex using the Plex PIN flow.
- Lets you choose a reachable Plex server connection.
- Lists currently playing Plex sessions.
- Opens the clip editor for sessions with a direct media file.
- Previews video and audio through Mediabunny.
- Uses `react-timeline-editor` for draggable clip selection.
- Exports MP4 clips at original quality, 1080p, or 720p.
- Proxies Plex media through the local server so the browser can read it safely.

## Workspace

This is a pnpm workspace with two apps:

- `apps/frontend`: Vite, React, Tailwind CSS, Mediabunny, and the timeline editor UI.
- `apps/server`: Express API for Plex auth, provider sessions, server selection, media session lookup, and media proxying.

## Requirements

- Node.js
- pnpm 10.x
- A Plex account with access to a Plex Media Server
- An active Plex playback session to clip from

## Local Setup

Install dependencies:

```sh
pnpm install
```

Copy the example environment file if you want local overrides:

```sh
cp .env.example .env.local
```

Run the app:

```sh
pnpm dev
```

The server listens on `http://localhost:3000`. In development it also mounts the Vite frontend through Express, so that URL is the easiest place to use the full app.

The standalone Vite frontend can also run on its own dev port. Its `/api` calls proxy to `http://localhost:3000` by default, or to `CLIPARR_API_URL` if you set it.

## Environment

Useful local variables:

- `APP_URL`: Base URL for Cliparr auth links. Plex returns to `/auth/plex/complete` under this URL so the sign-in tab does not load a second app instance. Defaults to `http://localhost:3000`.
- `PORT`: Express server port. Defaults to `3000`.
- `PLEX_CLIENT_IDENTIFIER`: Optional stable Plex client ID. If omitted, Cliparr creates one at server startup.
- `CLIPARR_API_URL`: Optional frontend dev proxy target when using the standalone Vite server.

## Scripts

```sh
pnpm dev       # run frontend and server in development
pnpm build     # build all workspace packages
pnpm lint      # type-check all workspace packages
pnpm preview   # serve the built frontend through the server
pnpm start     # run the built server
pnpm clean     # remove build output
```

## Docker

Build a local image:

```sh
docker build -t cliparr .
```

Run it:

```sh
docker run --rm -p 3000:3000 -e APP_URL=http://localhost:3000 cliparr
```

Tagged releases publish a multi-platform image to GitHub Container Registry.

## How Clipping Works

1. Cliparr starts Plex PIN auth and stores the Plex session server-side.
2. You choose a Plex server connection. Cliparr probes the discovered routes and uses a reachable one.
3. Cliparr reads `/status/sessions` from Plex and builds editable media sessions.
4. The editor loads the original media URL through the Cliparr media proxy.
5. Mediabunny decodes preview frames/audio in the browser.
6. The selected timeline range is converted to an MP4 Blob and downloaded locally.

## Notes

- Provider credentials and media handles are kept in server memory.
- Sessions expire after 12 hours.
- Restarting the server clears active Cliparr sessions.
- Export work happens in the browser, so very large clips can be CPU and memory heavy.
- Some Plex sessions may show as `No direct media file` when Cliparr cannot resolve a usable media part.

## Stack

- React 19
- Vite 6
- Tailwind CSS 4
- Mediabunny
- `@xzdarcy/react-timeline-editor`
- Express
- TypeScript
- pnpm workspaces

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and pull request guidance.

Please report security concerns privately. See [SECURITY.md](SECURITY.md).

## License

Cliparr is released under the [MIT License](LICENSE).
