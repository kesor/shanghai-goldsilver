#!/usr/bin/env bash

# Auto-update script for COMEX data
# Run via cron: 0 */4 * * * /path/to/update_and_deploy.sh

cd "$(dirname "$0")"

# Fetch today's data
./fetch.sh

# Clean up empty files
./cleanup_empty.sh

# Deploy to server
./deploy.sh

echo "$(date): Update complete" >> update.log
