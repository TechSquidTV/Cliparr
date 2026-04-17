#!/bin/sh

set -eu

PLEX_BASE_URL="${PLEX_BASE_URL:-http://plex:32400}"
PLEX_LIBRARY_NAME="${PLEX_LIBRARY_NAME:-Movies}"
PLEX_LIBRARY_PATH="${PLEX_LIBRARY_PATH:-/data/movies}"
PLEX_LIBRARY_LANGUAGE="${PLEX_LIBRARY_LANGUAGE:-en-US}"
PLEX_LIBRARY_TYPE="${PLEX_LIBRARY_TYPE:-movie}"
PLEX_LIBRARY_AGENT="${PLEX_LIBRARY_AGENT:-tv.plex.agents.movie}"
PLEX_LIBRARY_SCANNER="${PLEX_LIBRARY_SCANNER:-Plex Movie}"

urlencode() {
  jq -nr --arg value "$1" '$value|@uri'
}

curl_plex() {
  url="$1"
  shift

  curl -fsS "$@" "$url"
}

wait_for_plex() {
  attempt=0

  while [ "$attempt" -lt 90 ]; do
    if curl_plex "$PLEX_BASE_URL/identity" >/dev/null 2>&1; then
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  return 1
}

wait_for_sections() {
  attempt=0

  while [ "$attempt" -lt 60 ]; do
    sections_xml="$(curl_plex "$PLEX_BASE_URL/library/sections" 2>/dev/null || true)"
    if [ -n "$sections_xml" ]; then
      printf '%s' "$sections_xml"
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  return 1
}

create_library() {
  url="$1"
  attempt=0

  while [ "$attempt" -lt 30 ]; do
    if curl_plex "$url" -X POST >/dev/null 2>&1; then
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  return 1
}

if ! wait_for_plex; then
  echo "Plex did not become ready in time. Skipping library bootstrap." >&2
  exit 0
fi

if ! sections_xml="$(wait_for_sections)"; then
  echo "Plex library automation is not available yet. Add $PLEX_LIBRARY_PATH manually if needed." >&2
  exit 0
fi

if printf '%s' "$sections_xml" | grep -q "title=\"$PLEX_LIBRARY_NAME\""; then
  echo "Plex library '$PLEX_LIBRARY_NAME' already exists."
  exit 0
fi

echo "Creating Plex library '$PLEX_LIBRARY_NAME'."
query="name=$(urlencode "$PLEX_LIBRARY_NAME")"
query="$query&type=$(urlencode "$PLEX_LIBRARY_TYPE")"
query="$query&agent=$(urlencode "$PLEX_LIBRARY_AGENT")"
query="$query&scanner=$(urlencode "$PLEX_LIBRARY_SCANNER")"
query="$query&language=$(urlencode "$PLEX_LIBRARY_LANGUAGE")"
query="$query&location=$(urlencode "$PLEX_LIBRARY_PATH")"

if ! create_library "$PLEX_BASE_URL/library/sections?$query"; then
  echo "Plex library bootstrap failed. Claim Plex and add $PLEX_LIBRARY_PATH manually if needed." >&2
  exit 0
fi

echo "Plex bootstrap complete."
