# Contributing

Thanks for helping improve Cliparr.

## Development

Requirements:

- Node.js 24 or newer
- pnpm 10.x
- A Plex account and a reachable Plex Media Server for manual end-to-end testing

Install dependencies:

```sh
pnpm install
```

Run the development server:

```sh
pnpm dev
```

Open the app at http://localhost:5173. The API server runs on http://localhost:3000 and redirects auth callback pages back to the Vite frontend during development.

Before opening a pull request, run:

```sh
pnpm lint
pnpm build
```

## Pull Requests

- Keep changes focused and explain the user-visible behavior they affect.
- Include screenshots or short screen recordings for UI changes when helpful.
- Note any Plex setup needed to reproduce provider/session behavior.
- Avoid committing generated output such as `dist`, `node_modules`, `.pnpm-store`, or TypeScript build info files.

## Security

Do not include Plex tokens, server URLs, local media paths, or other private account details in issues, logs, screenshots, or pull requests.
