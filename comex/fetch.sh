#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "$SCRIPT_DIR/cookies.txt" ]; then
  echo "ERROR: cookies.txt not found in $SCRIPT_DIR"
  exit 1
fi
COOKIES=$(cat "$SCRIPT_DIR/cookies.txt")

fetch_date() {
  local DATE=$1
  local FORMATTED_DATE="${DATE:0:4}-${DATE:4:2}-${DATE:6:2}"
  local OUTPUT="$HOME/kesor.net/comex/silver/${FORMATTED_DATE}-data.json"
  
  if [ -f "$OUTPUT" ]; then
    echo "Skipping $OUTPUT (already exists)"
    return 0
  fi
  
  local TIMESTAMP=$(date +%s)000
  
  curl -s "https://www.cmegroup.com/CmeWS/mvc/Volume/Details/F/458/${DATE}/P?tradeDate=${DATE}&pageSize=500&isProtected&_t=${TIMESTAMP}" \
    -H 'accept: application/json, text/plain, */*' \
    -H 'accept-language: en-US,en;q=0.6' \
    -H 'cache-control: no-cache' \
    -b "$COOKIES" \
    -H 'dnt: 1' \
    -H 'pragma: no-cache' \
    -H 'priority: u=1, i' \
    -H 'referer: https://www.cmegroup.com/markets/metals/precious/silver.volume.html' \
    -H 'sec-ch-ua: "Not(A:Brand";v="8", "Chromium";v="144", "Brave";v="144"' \
    -H 'sec-ch-ua-mobile: ?0' \
    -H 'sec-ch-ua-platform: "Linux"' \
    -H 'sec-fetch-dest: empty' \
    -H 'sec-fetch-mode: cors' \
    -H 'sec-fetch-site: same-origin' \
    -H 'sec-gpc: 1' \
    -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36' \
    > "$OUTPUT"
  
  if [ -s "$OUTPUT" ]; then
    echo "Fetched data to $OUTPUT"
    python3 -c "
import json
manifest_file = '$HOME/kesor.net/comex/silver/manifest.json'
with open(manifest_file) as f:
    data = json.load(f)
filename = '${FORMATTED_DATE}-data.json'
if filename not in data:
    data.append(filename)
    data.sort()
with open(manifest_file, 'w') as f:
    json.dump(data, f)
"
  else
    echo "Failed to fetch $DATE"
    rm -f "$OUTPUT"
    return 1
  fi
}

if [ -n "$1" ]; then
  fetch_date "$1"
else
  fetch_date "$(date +%Y%m%d)"
fi
