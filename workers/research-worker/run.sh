#!/bin/bash
# launchd entry point: reads WORKER_TOKEN from the login Keychain so the secret
# never sits in the plist or the repo.
#   store it:  security add-generic-password -a creativeintel -s creativeintel-worker-token -w <token> -U
set -euo pipefail
cd "$(dirname "$0")"
WORKER_TOKEN="$(security find-generic-password -s creativeintel-worker-token -w)"
export WORKER_TOKEN
export APP_URL="${APP_URL:-https://creativeintel.vercel.app}"
exec node worker.mjs
