#!/usr/bin/env bash

# Auto-update script for COMEX data
# Run via cron: 0 */4 * * * /path/to/update_and_deploy.sh

cd "$(dirname "$0")"

# Fetch today's data for both commodities
./fetch.sh
./fetch_gold.sh

# Clean up empty files
cd silver && ../cleanup_empty.sh . && cd ..
cd gold && ../cleanup_empty.sh . && cd ..

# Deploy to server
./deploy.sh

echo "$(date): Update complete" >> update.log
