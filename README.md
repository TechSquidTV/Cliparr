# Cliparr

![Cliparr](./.github/img/screenshot.png)

Media clipper for pulling quick MP4s out of whatever is currently playing on your personal media server.

Cliparr connects to Plex, finds active playback sessions, lets you mark a clip range on a timeline, previews the original media in the browser, and exports an MP4 without setting up a heavyweight editing pipeline.

- Instantly loads your media player's currently playing file.
- Intuitive single-track editor for selecting clip
- Advanced metadata tagging. Clip will include rich exif data, like Season and Episode numbers, and timing data.
- Select resolution; transcoding happens in-browser.

Built with [Mediabunny](https://mediabunny.dev/) and [`react-timeline-editor`](https://github.com/xzdarcy/react-timeline-editor).


## Docker

### GitHub Container Registry

The easiest way to run Cliparr is using the official image from the GitHub Container Registry:

```sh
docker run --rm -p 3000:3000 -e APP_URL=http://localhost:3000 ghcr.io/techsquidtv/cliparr:latest
```

### Local Build

If you want to build the image locally:

```sh
docker build -t cliparr .
```

And run it:

```sh
docker run --rm -p 3000:3000 -e APP_URL=http://localhost:3000 cliparr
```


## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and pull request guidance.

Please report security concerns privately. See [SECURITY.md](SECURITY.md).

## License

Cliparr is released under the [MIT License](LICENSE).
