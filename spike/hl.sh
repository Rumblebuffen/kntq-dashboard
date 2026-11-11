#!/bin/sh
# Throwaway: POST a JSON body to the Hyperliquid info API, save to spike/out/<name>.json, print it.
# usage: spike/hl.sh <name> '<json body>'
curl -s -m 30 -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' -d "$2" -o "$(dirname "$0")/out/$1.json" -w '%{http_code} %{size_download}b\n' >&2
cat "$(dirname "$0")/out/$1.json"
