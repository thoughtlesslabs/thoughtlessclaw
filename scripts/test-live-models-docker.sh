#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${SKYNET_IMAGE:-${CLAWDBOT_IMAGE:-skynet:local}}"
CONFIG_DIR="${SKYNET_CONFIG_DIR:-${CLAWDBOT_CONFIG_DIR:-$HOME/.skynet}}"
WORKSPACE_DIR="${SKYNET_WORKSPACE_DIR:-${CLAWDBOT_WORKSPACE_DIR:-$HOME/.skynet/workspace}}"
PROFILE_FILE="${SKYNET_PROFILE_FILE:-${CLAWDBOT_PROFILE_FILE:-$HOME/.profile}}"

PROFILE_MOUNT=()
if [[ -f "$PROFILE_FILE" ]]; then
  PROFILE_MOUNT=(-v "$PROFILE_FILE":/home/node/.profile:ro)
fi

echo "==> Build image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" -f "$ROOT_DIR/Dockerfile" "$ROOT_DIR"

echo "==> Run live model tests (profile keys)"
docker run --rm -t \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  -e SKYNET_LIVE_TEST=1 \
  -e SKYNET_LIVE_MODELS="${SKYNET_LIVE_MODELS:-${CLAWDBOT_LIVE_MODELS:-all}}" \
  -e SKYNET_LIVE_PROVIDERS="${SKYNET_LIVE_PROVIDERS:-${CLAWDBOT_LIVE_PROVIDERS:-}}" \
  -e SKYNET_LIVE_MODEL_TIMEOUT_MS="${SKYNET_LIVE_MODEL_TIMEOUT_MS:-${CLAWDBOT_LIVE_MODEL_TIMEOUT_MS:-}}" \
  -e SKYNET_LIVE_REQUIRE_PROFILE_KEYS="${SKYNET_LIVE_REQUIRE_PROFILE_KEYS:-${CLAWDBOT_LIVE_REQUIRE_PROFILE_KEYS:-}}" \
  -v "$CONFIG_DIR":/home/node/.skynet \
  -v "$WORKSPACE_DIR":/home/node/.skynet/workspace \
  "${PROFILE_MOUNT[@]}" \
  "$IMAGE_NAME" \
  -lc "set -euo pipefail; [ -f \"$HOME/.profile\" ] && source \"$HOME/.profile\" || true; cd /app && pnpm test:live"
