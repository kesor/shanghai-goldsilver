#!/usr/bin/env bash

# Usage: ./fetch_gold.sh [YYYYMMDD]
# If no date provided, fetches today or all missing trading days

# Read cookies from cookies.txt
if [ ! -f "cookies.txt" ]; then
  echo "Error: cookies.txt not found"
  exit 1
fi
COOKIES=$(cat cookies.txt)

fetch_date() {
  local DATE=$1
  local FORMATTED_DATE="${DATE:0:4}-${DATE:4:2}-${DATE:6:2}"
  local OUTPUT="gold/${FORMATTED_DATE}-data.json"
  
  # Skip if already exists
  if [ -f "$OUTPUT" ]; then
    echo "Skipping $OUTPUT (already exists)"
    return 0
  fi
  
  local TIMESTAMP=$(date +%s)000
  
  curl -s "https://www.cmegroup.com/CmeWS/mvc/Volume/Details/F/437/${DATE}/P?tradeDate=${DATE}&pageSize=500&isProtected&_t=${TIMESTAMP}" \
    -H 'accept: application/json, text/plain, */*' \
    -H 'accept-language: en-US,en;q=0.6' \
    -H 'cache-control: no-cache' \
    -b "$COOKIES" \
    -H 'dnt: 1' \
    -H 'pragma: no-cache' \
    -H 'referer: https://www.cmegroup.com/markets/metals/precious/gold.volume.html' \
    -H 'sec-fetch-dest: empty' \
    -H 'sec-fetch-mode: cors' \
    -H 'sec-fetch-site: same-origin' \
    -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36' \
    | jq '.' > "$OUTPUT"
  
  if [ -s "$OUTPUT" ]; then
    echo "Fetched data to $OUTPUT"
    
    # Update manifest
    cd gold
    jq ". += [\"${FORMATTED_DATE}-data.json\"] | sort | unique" manifest.json > manifest.json.tmp
    mv manifest.json.tmp manifest.json
    cd ..
  else
    echo "Failed to fetch $OUTPUT"
    rm -f "$OUTPUT"
    return 1
  fi
}

# If date provided, fetch that date
if [ -n "$1" ]; then
  fetch_date "$1"
else
  # Fetch today
  TODAY=$(date +%Y%m%d)
  fetch_date "$TODAY"
fi
