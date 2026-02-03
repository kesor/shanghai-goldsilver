#!/usr/bin/env bash

# Fetch historical data going backwards from a start date
# Usage: ./fetch_historical.sh [START_DATE] [END_DATE]
# Example: ./fetch_historical.sh 20260101 20251201

START_DATE=${1:-20260101}
END_DATE=${2:-20251201}

echo "Fetching data from $START_DATE back to $END_DATE"

current=$START_DATE
while [ "$current" -ge "$END_DATE" ]; do
  echo "Fetching $current..."
  ./fetch.sh "$current"
  
  # Sleep 2 seconds between requests to be polite
  sleep 2
  
  # Go back one day
  current=$(date -d "${current:0:4}-${current:4:2}-${current:6:2} -1 day" +%Y%m%d)
done

echo "Done! Check manifest.json for all fetched dates"
