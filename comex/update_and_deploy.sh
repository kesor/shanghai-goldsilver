#!/usr/bin/env bash

# Auto-update script for COMEX data
# Run via cron: 0 */4 * * * ~/comex/update_and_deploy.sh

cd ~/kesor.net/comex

# Fetch today's data for both commodities
~/comex/fetch.sh
~/comex/fetch_gold.sh

# Clean up empty files using Python
python3 << 'PYTHON'
import json
import os
import glob

for commodity in ['silver', 'gold']:
    for file in glob.glob(f'{commodity}/*-data.json'):
        try:
            with open(file) as f:
                data = json.load(f)
            # Remove if empty or blocked
            if data.get('empty') == True or 'message' in data:
                os.remove(file)
                print(f"Removed {file}")
                filename = os.path.basename(file)
                manifest_file = f'{commodity}/manifest.json'
                with open(manifest_file) as f:
                    manifest = json.load(f)
                if filename in manifest:
                    manifest.remove(filename)
                with open(manifest_file, 'w') as f:
                    json.dump(manifest, f)
        except:
            pass
PYTHON

echo "$(date): Update complete" >> ~/comex/update.log
