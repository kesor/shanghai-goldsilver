#!/usr/bin/env bash
scp sankey.html manifest.json *.json kesor@ssh.kesor.net:~/kesor.net/comex/
ssh kesor@ssh.kesor.net "cd ~/kesor.net/comex && cp sankey.html index.html"
echo "Deployed to https://kesor.net/comex/"
