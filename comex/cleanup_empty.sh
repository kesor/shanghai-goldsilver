#!/usr/bin/env bash

# Remove empty trading day files and update manifest

echo "Finding empty data files..."

for file in *-data.json; do
  if [ -f "$file" ] && grep -q '"empty": true' "$file"; then
    echo "Removing $file (no trading data)"
    rm "$file"
    # Remove from manifest
    jq "del(.[] | select(. == \"$file\"))" manifest.json > manifest.json.tmp
    mv manifest.json.tmp manifest.json
  fi
done

echo "Cleanup complete!"
