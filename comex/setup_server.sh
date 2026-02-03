#!/usr/bin/env bash

# Setup script to configure COMEX data fetching on server
# Run this once: ./setup_server.sh

SERVER="kesor@ssh.kesor.net"
SCRIPT_DIR="~/comex"
PUBLIC_DIR="~/kesor.net/comex"

echo "Setting up COMEX data fetching on server..."

# Create directories
ssh $SERVER "mkdir -p $SCRIPT_DIR $PUBLIC_DIR"

# Copy scripts to private directory
echo "Copying scripts to $SCRIPT_DIR..."
scp fetch.sh cleanup_empty.sh $SERVER:$SCRIPT_DIR/

# Copy current data and HTML to public directory
echo "Copying data and HTML to $PUBLIC_DIR..."
scp sankey.html manifest.json *.json $SERVER:$PUBLIC_DIR/
ssh $SERVER "cd $PUBLIC_DIR && cp sankey.html index.html"

# Create server-side update script
echo "Creating server-side update script..."
ssh $SERVER "cat > $SCRIPT_DIR/update_and_deploy.sh << 'EOF'
#!/usr/bin/env bash

cd ~/comex

# Fetch today's data to public directory
TODAY=\$(date +%Y%m%d)
FORMATTED_DATE=\$(date +%Y-%m-%d)
OUTPUT=\"~/kesor.net/comex/\${FORMATTED_DATE}-data.json\"

# Skip if already exists
if [ -f \"\$OUTPUT\" ]; then
  echo \"Data for \$TODAY already exists\"
  exit 0
fi

# Extract cookies from environment or config file
if [ -f ~/comex/cookies.txt ]; then
  COOKIES=\$(cat ~/comex/cookies.txt)
else
  echo \"ERROR: cookies.txt not found. Please create ~/comex/cookies.txt with your browser cookies.\"
  exit 1
fi

TIMESTAMP=\$(date +%s)000

curl -s \"https://www.cmegroup.com/CmeWS/mvc/Volume/Details/F/458/\${TODAY}/P?tradeDate=\${TODAY}&pageSize=500&isProtected&_t=\${TIMESTAMP}\" \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'accept-language: en-US,en;q=0.6' \\
  -H 'cache-control: no-cache' \\
  -b \"\$COOKIES\" \\
  -H 'dnt: 1' \\
  -H 'pragma: no-cache' \\
  -H 'referer: https://www.cmegroup.com/markets/metals/precious/silver.volume.html' \\
  -H 'sec-fetch-dest: empty' \\
  -H 'sec-fetch-mode: cors' \\
  -H 'sec-fetch-site: same-origin' \\
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36' \\
  | jq '.' > \"\$OUTPUT\"

if [ -s \"\$OUTPUT\" ]; then
  # Check if empty
  if grep -q '\"empty\": true' \"\$OUTPUT\"; then
    echo \"No trading data for \$TODAY (weekend/holiday)\"
    rm \"\$OUTPUT\"
    exit 0
  fi
  
  echo \"Fetched data to \$OUTPUT\"
  
  # Update manifest
  cd ~/kesor.net/comex
  jq \". += [\\\"\${FORMATTED_DATE}-data.json\\\"] | sort | unique\" manifest.json > manifest.json.tmp
  mv manifest.json.tmp manifest.json
  
  echo \"\$(date): Successfully updated with \$FORMATTED_DATE\" >> ~/comex/update.log
else
  echo \"Failed to fetch data for \$TODAY\"
  rm -f \"\$OUTPUT\"
  exit 1
fi
EOF
"

ssh $SERVER "chmod +x $SCRIPT_DIR/update_and_deploy.sh"

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update cookies on server:"
echo "   ssh $SERVER"
echo "   echo 'YOUR_COOKIE_STRING' > ~/comex/cookies.txt"
echo ""
echo "2. Test the update script:"
echo "   ssh $SERVER '~/comex/update_and_deploy.sh'"
echo ""
echo "3. Add to crontab:"
echo "   ssh $SERVER 'crontab -e'"
echo "   Add line: 0 */4 * * * ~/comex/update_and_deploy.sh >> ~/comex/cron.log 2>&1"
echo ""
