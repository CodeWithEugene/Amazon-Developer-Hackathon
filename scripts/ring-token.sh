#!/bin/sh
# Saves a Ring Developer Playground token from the macOS clipboard into .env
# as RING_PLAYGROUND_ACCESS_TOKEN, replacing any previous one. The token is
# never printed. Copy the token in the Playground first, then run:
#   pnpm ring:token
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
TOKEN="$(pbpaste | tr -d '[:space:]')"
LEN=${#TOKEN}
case "$TOKEN" in
  *RING_PLAYGROUND*|*pbpaste*|*sed*|*\"*|*\'*)
    echo "The clipboard holds a command or quoted text, not a token. Copy the token in the Playground and run pnpm ring:token again." >&2
    exit 1 ;;
esac
if [ "$LEN" -lt 100 ]; then
  echo "The clipboard holds $LEN characters, which is too short for a Ring token. Copy the token in the Playground and run pnpm ring:token again." >&2
  exit 1
fi
if printf '%s' "$TOKEN" | LC_ALL=C grep -q '[^A-Za-z0-9._-]'; then
  echo "The clipboard text is not a Ring token (it has characters a token never contains). Copy the token in the Playground and run pnpm ring:token again." >&2
  exit 1
fi
touch "$ENV_FILE"
# Make sure the file ends with a newline before appending.
if [ -s "$ENV_FILE" ] && [ "$(tail -c 1 "$ENV_FILE" | od -An -c | tr -d ' ')" != '\n' ]; then
  printf '\n' >> "$ENV_FILE"
fi
LC_ALL=C sed -i '' '/^RING_PLAYGROUND_ACCESS_TOKEN=/d' "$ENV_FILE"
printf 'RING_PLAYGROUND_ACCESS_TOKEN=%s\n' "$TOKEN" >> "$ENV_FILE"
printf '' | pbcopy
echo "Saved a $LEN character Ring token to .env and cleared the clipboard. It expires about 30 minutes after you minted it."
