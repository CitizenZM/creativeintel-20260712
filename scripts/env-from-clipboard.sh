#!/bin/bash
# Add a Vercel production env var from the clipboard without ever printing it.
# Refuses to write unless the clipboard looks like the expected secret, so a
# clipboard that was overwritten in the meantime can't end up in production.
#
#   bash scripts/env-from-clipboard.sh OPENAI_API_KEY sk-
#   bash scripts/env-from-clipboard.sh META_ACCESS_TOKEN EAA
set -euo pipefail
name="${1:?usage: env-from-clipboard.sh NAME PREFIX}"
prefix="${2:?usage: env-from-clipboard.sh NAME PREFIX}"
cd "$(dirname "$0")/.."

value="$(pbpaste | tr -d '[:space:]')"
if [[ "$value" != "$prefix"* ]] || [[ ! "$value" =~ ^[A-Za-z0-9_.|-]+$ ]]; then
  echo "Clipboard does not hold a $name (expected it to start with \"$prefix\"). Copy it again and re-run." >&2
  exit 1
fi

vercel env rm "$name" production --yes >/dev/null 2>&1 || true
printf '%s' "$value" | vercel env add "$name" production >/dev/null
unset value
echo "$name updated in Vercel production (value not shown). Redeploy to apply."
