#!/bin/sh

set -eu

MEDIA_ROOT="${MEDIA_ROOT:-/media}"
MOVIE_TITLE="Sintel"
MOVIE_YEAR="2010"
MOVIE_DIR="$MEDIA_ROOT/movies/$MOVIE_TITLE ($MOVIE_YEAR)"
TARGET_FILE="$MOVIE_DIR/$MOVIE_TITLE ($MOVIE_YEAR).mkv"
TMP_FILE="$TARGET_FILE.part"
SINTEL_URL="${SINTEL_URL:-https://download.blender.org/demo/movies/Sintel.2010.720p.mkv}"

if [ "${CI:-}" = "true" ] || [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  echo "Skipping dev media download in CI."
  exit 0
fi

if [ -s "$TARGET_FILE" ]; then
  echo "$MOVIE_TITLE already present at $TARGET_FILE"
  exit 0
fi

mkdir -p "$MOVIE_DIR"
rm -f "$TMP_FILE"

echo "Downloading $MOVIE_TITLE into $TARGET_FILE"
curl -fL --retry 5 --retry-delay 2 --retry-connrefused "$SINTEL_URL" -o "$TMP_FILE"
mv "$TMP_FILE" "$TARGET_FILE"

echo "Seeded shared media library."
