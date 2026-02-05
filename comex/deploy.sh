#!/usr/bin/env bash
# Sync HTML files to public directory
rsync -av index.html silver.html gold.html kesor@ssh.kesor.net:~/kesor.net/comex/

# Sync data directories
rsync -av silver/ kesor@ssh.kesor.net:~/kesor.net/comex/silver/
rsync -av gold/ kesor@ssh.kesor.net:~/kesor.net/comex/gold/

# Sync scripts to private directory
rsync -av fetch.sh fetch_gold.sh cleanup_empty.sh update_and_deploy.sh cookies.txt kesor@ssh.kesor.net:~/comex/

echo "Deployed to https://kesor.net/comex/"
