#!/usr/bin/env bash

die() {
  echo "ERROR: $*"
  exit 1
}

if [ ! -f 'cookies.txt' ]; then
  die 'cookies.txt not found.'
fi

TS="$(date +%s)$(date +%N | cut -c-3)"

_GOLD=CmeWS/mvc/Volume/Details/F/437
_SILVER=CmeWS/mvc/Volume/Details/F/458

fetch() {
  local DATE=$1
  local FOLDER=$2
  local URLPART=$3
  local FORMATTED_DATE="${DATE:0:4}-${DATE:4:2}-${DATE:6:2}"
  local OUTPUT=kesor.net/comex/${FOLDER}/${FORMATTED_DATE}-data.json
  if [ -f "$OUTPUT" ]; then
    echo "skip ${OUTPUT} (already exists)"
    return 0
  fi
  curl "https://www.cmegroup.com/${URLPART}/20260511/P?tradeDate=20260511&pageSize=500&isProtected&_t=${TS}" \
    -b cookies.txt \
    -H 'accept: application/json, text/plain, */*' \
    -H 'referer: https://www.cmegroup.com/markets/metals/precious/silver.volume.html' \
    -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
}

fetch_silver() {
  fetch "$1" silver "$_SILVER"
}

fetch_gold() {
  fetch "$1" gold "$_GOLD"
}

DATE=$(date +%Y%m%d)
fetch_silver "${DATE}"
fetch_gold "${DATE}"
