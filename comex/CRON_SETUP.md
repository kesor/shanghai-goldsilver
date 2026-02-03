# COMEX Auto-Update Crontab Setup

## Installation on server:

1. Copy the comex folder to the server:
   ```bash
   scp -r ./comex kesor@ssh.kesor.net:~/
   ```

2. SSH to server and set up crontab:
   ```bash
   ssh kesor@ssh.kesor.net
   crontab -e
   ```

3. Add this line to run every 4 hours:
   ```
   0 */4 * * * cd ~/comex && ./update_and_deploy.sh >> ~/comex/cron.log 2>&1
   ```

## Cookie Management:

The fetch script requires browser cookies that expire periodically.

To update cookies:
1. Visit https://www.cmegroup.com/markets/metals/precious/silver.volume.html
2. Open DevTools > Network tab
3. Refresh page and find a request to the API
4. Right-click > Copy > Copy as cURL
5. Extract the cookie string from the -b parameter
6. SSH to server and update the COOKIES variable in ~/comex/fetch.sh

Cookies typically need updating every 1-2 weeks.

## Monitoring:

Check logs:
```bash
ssh kesor@ssh.kesor.net "tail -50 ~/comex/cron.log"
ssh kesor@ssh.kesor.net "tail -20 ~/comex/update.log"
```

## Alternative: Local cron + git push

If cookie management is too cumbersome, run cron locally:
```bash
crontab -e
# Add: 0 */4 * * * cd ~/src/goldsilver/comex && ./update_and_deploy.sh
```
