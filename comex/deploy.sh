#!/usr/bin/env bash
# Sync public files
rsync -av .htaccess *.html *.css *.js silver gold ssh.kesor.net:kesor.net/comex/

# Sync private scripts
rsync -av fetch.sh fetch_gold.sh cleanup_empty.sh update_and_deploy.sh kesor@ssh.kesor.net:~/comex/

echo "Deployed to https://kesor.net/comex/"
