#!/usr/bin/env bash
# Sync public files
rsync -av index.html silver.html gold.html .htaccess chart-styles.css *.js silver/ gold/ kesor@ssh.kesor.net:~/kesor.net/comex/

# Sync private scripts
rsync -av fetch.sh fetch_gold.sh cleanup_empty.sh update_and_deploy.sh kesor@ssh.kesor.net:~/comex/

echo "Deployed to https://kesor.net/comex/"
