#!/usr/bin/env python3
import requests
import matplotlib.pyplot as plt
import json

# Fetch Shanghai Silver data
response = requests.post(
    'https://en.sge.com.cn/graph/quotations',
    headers={
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': 'https://en.sge.com.cn',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
    },
    data='instid=Ag(T%2BD)'
)

if response.status_code != 200 or not response.text.strip():
    # Fallback: use curl to get data
    import subprocess
    result = subprocess.run([
        'curl', '-s', 'https://en.sge.com.cn/graph/quotations',
        '-H', 'Accept: application/json, text/javascript, */*; q=0.01',
        '-H', 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
        '-H', 'Origin: https://en.sge.com.cn',
        '--data-raw', 'instid=Ag(T%2BD)'
    ], capture_output=True, text=True)
    data = json.loads(result.stdout)
else:
    data = response.json()

times = data['times']
prices = [float(p) for p in data['data']]

# Convert CNY/kg to USD/troy ounce
# 1 kg = 1000g, 1 troy ounce = 31.10348g, USD/CNY = 1/7.03
usd_prices = [(p / 1000) * 31.10348 / 7.03 for p in prices]

# Create chart with dual y-axes
fig, ax1 = plt.subplots(figsize=(14, 8))

# Identify break periods and set prices to NaN (no line will be drawn)
import numpy as np
filtered_prices = prices.copy()
filtered_usd_prices = usd_prices.copy()

from datetime import datetime
import pytz
import numpy as np

# Get current Shanghai time
shanghai_tz = pytz.timezone('Asia/Shanghai')
current_shanghai = datetime.now(shanghai_tz)
current_hour, current_minute = current_shanghai.hour, current_shanghai.minute
current_time_minutes = current_hour * 60 + current_minute

for i, time_str in enumerate(times):
    hour, minute = map(int, time_str.split(':'))
    data_time_minutes = hour * 60 + minute
    
    # Handle day rollover (times after midnight)
    if hour < 20:  # Next day times (00:00-19:59)
        data_time_minutes += 24 * 60
    
    # Filter out future data (after current Shanghai time)
    if data_time_minutes > current_time_minutes + 24 * 60:  # Adjust for day rollover
        filtered_prices[i] = np.nan
        filtered_usd_prices[i] = np.nan

# Plot CNY/kg on left axis
ax1.plot(times, filtered_prices, 'b-', linewidth=2)
ax1.set_xlabel('Time')
ax1.set_ylabel('Price (CNY/kg)', color='b')
ax1.tick_params(axis='y', labelcolor='b')

# Create second y-axis for USD/troy oz
ax2 = ax1.twinx()
ax2.plot(times, filtered_usd_prices, 'r-', linewidth=2)
ax2.set_ylabel('Price (USD/troy oz)', color='r')
ax2.tick_params(axis='y', labelcolor='r')

# Find max values
max_cny = max(prices)
max_usd = max(usd_prices)
max_time = times[prices.index(max_cny)]

# Add background shading for trading sessions
# Night session: 20:00-02:30, Day session: 09:00-15:30
night_start = None
night_end = None
day_start = None
day_end = None

for i, time_str in enumerate(times):
    hour = int(time_str.split(':')[0])
    if hour == 20 and night_start is None:
        night_start = i
    elif hour == 2 and night_end is None and night_start is not None:
        night_end = i
    elif hour == 9 and day_start is None:
        day_start = i
    elif hour == 15 and day_end is None and day_start is not None:
        day_end = i

# Add shaded regions
if night_start is not None and night_end is not None:
    ax1.axvspan(night_start, night_end, alpha=0.2, color='blue', label='Night Session')
if day_start is not None and day_end is not None:
    ax1.axvspan(day_start, day_end, alpha=0.2, color='orange', label='Day Session')

plt.title(f'Shanghai Silver (Ag T+D) Price Chart\nUSD/CNY: 7.03, Troy oz: 31.10348g\nMax: {max_cny:.1f} CNY/kg ({max_usd:.2f} USD/oz) at {max_time}')
plt.grid(True, alpha=0.3)

# Show every 10th time label to avoid overlap
step = max(1, len(times) // 10)
ax1.set_xticks(range(0, len(times), step))
ax1.set_xticklabels([times[i] for i in range(0, len(times), step)], rotation=45)

plt.tight_layout()
plt.show()
