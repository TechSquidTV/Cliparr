#!/bin/sh

set -eu

JELLYFIN_BASE_URL="${JELLYFIN_BASE_URL:-http://jellyfin:8096}"
JELLYFIN_ADMIN_USERNAME="${JELLYFIN_ADMIN_USERNAME:-cliparr}"
JELLYFIN_ADMIN_PASSWORD="${JELLYFIN_ADMIN_PASSWORD:-cliparr-dev}"
JELLYFIN_LIBRARY_NAME="${JELLYFIN_LIBRARY_NAME:-Movies}"
JELLYFIN_LIBRARY_PATH="${JELLYFIN_LIBRARY_PATH:-/media/movies}"
JELLYFIN_DEVICE_ID="${JELLYFIN_DEVICE_ID:-cliparr-dev-jellyfin-bootstrap}"

jellyfin_auth_header() {
  if [ $# -gt 0 ] && [ -n "$1" ]; then
    printf 'MediaBrowser Client="Cliparr%%20Dev", Device="Bootstrap", DeviceId="%s", Version="1.0.0", Token="%s"' "$JELLYFIN_DEVICE_ID" "$1"
    return
  fi

  printf 'MediaBrowser Client="Cliparr%%20Dev", Device="Bootstrap", DeviceId="%s", Version="1.0.0"' "$JELLYFIN_DEVICE_ID"
}

urlencode() {
  jq -nr --arg value "$1" '$value|@uri'
}

wait_for_public_info() {
  attempt=0

  while [ "$attempt" -lt 60 ]; do
    if public_info="$(curl -fsS "$JELLYFIN_BASE_URL/System/Info/Public" 2>/dev/null)"; then
      printf '%s' "$public_info"
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  echo "Timed out waiting for Jellyfin at $JELLYFIN_BASE_URL" >&2
  return 1
}

startup_completed_from_public_info() {
  printf '%s' "$1" | jq -r '.StartupWizardCompleted // false'
}

wait_for_startup_ready_or_completed() {
  initial_public_info="$1"
  public_info="$initial_public_info"
  attempt=0

  while [ "$attempt" -lt 60 ]; do
    startup_completed="$(startup_completed_from_public_info "$public_info")"
    if [ "$startup_completed" = "true" ]; then
      printf '%s' "$public_info"
      return 0
    fi

    if curl -fsS "$JELLYFIN_BASE_URL/Startup/User" \
      -H "Authorization: $(jellyfin_auth_header)" \
      -H "Accept: application/json" \
      >/dev/null 2>&1; then
      printf '%s' "$public_info"
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 2
    public_info="$(wait_for_public_info)"
  done

  echo "Timed out waiting for Jellyfin startup endpoints." >&2
  return 1
}

post_jellyfin_with_retries() {
  path="$1"
  token="${2:-}"
  body="${3:-}"
  attempt=0

  while [ "$attempt" -lt 30 ]; do
    if [ -n "$body" ]; then
      if curl -fsS -X POST "$JELLYFIN_BASE_URL$path" \
        -H "Authorization: $(jellyfin_auth_header "$token")" \
        -H "Content-Type: application/json" \
        -d "$body" \
        >/dev/null 2>&1; then
        return 0
      fi
    elif curl -fsS -X POST "$JELLYFIN_BASE_URL$path" \
      -H "Authorization: $(jellyfin_auth_header "$token")" \
      >/dev/null 2>&1; then
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 2
  done

  echo "Timed out POSTing to Jellyfin path $path" >&2
  return 1
}

login_jellyfin() {
  attempt=0

  while [ "$attempt" -lt 30 ]; do
    auth_result="$(curl -fsS -X POST "$JELLYFIN_BASE_URL/Users/AuthenticateByName" \
      -H "Authorization: $(jellyfin_auth_header)" \
      -H "Accept: application/json" \
      -H "Content-Type: application/json" \
      -d "$(jq -nc --arg username "$JELLYFIN_ADMIN_USERNAME" --arg password "$JELLYFIN_ADMIN_PASSWORD" '{Username: $username, Pw: $password}')" 2>/dev/null || true)"

    access_token="$(printf '%s' "$auth_result" | jq -r '.AccessToken // empty' 2>/dev/null || true)"
    if [ -n "$access_token" ]; then
      printf '%s' "$access_token"
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 1
  done

  echo "Timed out authenticating to Jellyfin with the seeded admin account." >&2
  return 1
}

public_info="$(wait_for_public_info)"
public_info="$(wait_for_startup_ready_or_completed "$public_info")"
startup_completed="$(startup_completed_from_public_info "$public_info")"

if [ "$startup_completed" != "true" ]; then
  echo "Completing Jellyfin startup wizard."

  post_jellyfin_with_retries \
    "/Startup/User" \
    "" \
    "$(jq -nc --arg name "$JELLYFIN_ADMIN_USERNAME" --arg password "$JELLYFIN_ADMIN_PASSWORD" '{Name: $name, Password: $password}')"

  post_jellyfin_with_retries \
    "/Startup/RemoteAccess" \
    "" \
    '{"EnableRemoteAccess":false,"EnableAutomaticPortMapping":false}'

  post_jellyfin_with_retries "/Startup/Complete"
fi

access_token="$(login_jellyfin)"
libraries="$(curl -fsS \
  -H "Authorization: $(jellyfin_auth_header "$access_token")" \
  -H "Accept: application/json" \
  "$JELLYFIN_BASE_URL/Library/VirtualFolders")"

if printf '%s' "$libraries" | jq -e --arg name "$JELLYFIN_LIBRARY_NAME" 'any(.[]?; .Name == $name)' >/dev/null; then
  echo "Jellyfin library '$JELLYFIN_LIBRARY_NAME' already exists."
  exit 0
fi

echo "Creating Jellyfin library '$JELLYFIN_LIBRARY_NAME'."
query="name=$(urlencode "$JELLYFIN_LIBRARY_NAME")&collectionType=movies&paths=$(urlencode "$JELLYFIN_LIBRARY_PATH")&refreshLibrary=true"

post_jellyfin_with_retries \
  "/Library/VirtualFolders?$query" \
  "$access_token" \
  '{"LibraryOptions":{}}'

echo "Jellyfin bootstrap complete."
