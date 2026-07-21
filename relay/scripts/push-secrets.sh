#!/usr/bin/env bash
#
# Load the relay's secrets from OUTSIDE the repo and push them into Cloudflare's
# encrypted secret store. Nothing sensitive lives in this folder.
#
# A Cloudflare Worker has no filesystem at runtime, so — unlike fastlane, which
# reads the .p8 path on every build — we read the external .p8 once here and
# upload it as a Worker secret. Same principle: the key file stays external and
# only a *path* is referenced (see fastlane/.env / APP_STORE_CONNECT_KEY_FILE).
#
# Config lives in an env file outside the repo, mirroring fastlane/.env:
#   default: ~/.config/tablemate-push-relay/relay.env   (override with $RELAY_ENV)
# Copy relay.env.example there and fill it in.

set -euo pipefail

RELAY_ENV="${RELAY_ENV:-$HOME/.config/tablemate-push-relay/relay.env}"

if [[ ! -f "$RELAY_ENV" ]]; then
  echo "Config not found: $RELAY_ENV" >&2
  echo "Copy relay/relay.env.example there and fill it in (see relay/README.md)." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$RELAY_ENV"; set +a

: "${APNS_KEY_ID:?set APNS_KEY_ID in $RELAY_ENV}"
: "${APNS_TEAM_ID:?set APNS_TEAM_ID in $RELAY_ENV}"
: "${RELAY_TEST_SECRET:?set RELAY_TEST_SECRET in $RELAY_ENV}"

cd "$(dirname "$0")/.."

# APNS_KEY: prefer inline base64 content (CI, no file on disk); otherwise read
# the external .p8 path — same precedence as the Fastfile.
if [[ -n "${APNS_KEY_CONTENT:-}" ]]; then
  echo "Uploading APNS_KEY from APNS_KEY_CONTENT (base64)"
  printf '%s' "$APNS_KEY_CONTENT" | base64 --decode | npx wrangler secret put APNS_KEY
elif [[ -n "${APNS_KEY_FILE:-}" ]]; then
  if [[ ! -f "$APNS_KEY_FILE" ]]; then
    echo "APNs key file not found: $APNS_KEY_FILE" >&2
    exit 1
  fi
  echo "Uploading APNS_KEY from $APNS_KEY_FILE"
  npx wrangler secret put APNS_KEY < "$APNS_KEY_FILE"
else
  echo "Set APNS_KEY_FILE (local .p8 path) or APNS_KEY_CONTENT (base64 .p8 for CI) in $RELAY_ENV" >&2
  exit 1
fi

printf '%s' "$APNS_KEY_ID"       | npx wrangler secret put APNS_KEY_ID
printf '%s' "$APNS_TEAM_ID"      | npx wrangler secret put APNS_TEAM_ID
printf '%s' "$RELAY_TEST_SECRET" | npx wrangler secret put RELAY_TEST_SECRET

echo
echo "Secrets uploaded. Deploy with: npm run deploy"
