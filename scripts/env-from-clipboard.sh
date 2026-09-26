#!/bin/bash
# Add a Vercel production env var from the clipboard without ever printing it.
# Refuses to write unless the clipboard looks like the expected secret, so a
# clipboard that was overwritten in the meantime can't end up in production.
#
#   bash scripts/env-from-clipboard.sh OPENAI_API_KEY sk-
#   bash scripts/env-from-clipboard.sh META_ACCESS_TOKEN EAA
#   bash scripts/env-from-clipboard.sh ZHIPU_API_KEY ""        # no fixed prefix
set -euo pipefail
name="${1:?usage: env-from-clipboard.sh NAME PREFIX}"
prefix="${2-}"
cd "$(dirname "$0")/.."

matches() { [[ "$1" == "$prefix"* ]] && [[ ${#1} -ge 20 ]] && [[ "$1" =~ ^[A-Za-z0-9_.|-]+$ ]]; }

# Wait for the secret to be copied, so nothing can overwrite the clipboard
# between copying and running this.
value="$(pbpaste | tr -d '[:space:]')"
if ! matches "$value"; then
  wait_s="${WAIT_SECONDS:-120}"
  echo "Waiting up to $((wait_s / 60)) minutes — click Copy on the $name now…"
  for _ in $(seq 1 "$wait_s"); do
    sleep 1
    value="$(pbpaste | tr -d '[:space:]')"
    matches "$value" && break
  done
fi
if ! matches "$value"; then
  echo "No $name (starting with \"$prefix\") was copied. Re-run and click Copy." >&2
  exit 1
fi

vercel env rm "$name" production --yes >/dev/null 2>&1 || true
printf '%s' "$value" | vercel env add "$name" production >/dev/null
unset value
echo "$name updated in Vercel production (value not shown). Redeploy to apply."
