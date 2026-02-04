#!/usr/bin/env bash
# Run this locally to create SSH tunnel
# Usage: ./setup_tunnel.sh

echo "Creating SSH tunnel (SOCKS proxy on port 9050)..."
ssh -D 9050 -N -f kesor@ssh.kesor.net
echo "Tunnel created. Server can now use: curl --socks5 localhost:9050"
