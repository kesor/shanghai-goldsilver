#!/usr/bin/env python3
import requests
import matplotlib.pyplot as plt
import json
import time
import threading
from datetime import datetime
import pytz
import numpy as np
from matplotlib.animation import FuncAnimation
import pandas as pd
import sqlite3
import os
import logging
import signal
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Set dark theme
plt.style.use('dark_background')
plt.rcParams['toolbar'] = 'None'

# Configuration
USD_CNY_RATE = 7.0060  # Default fallback rate
TROY_OUNCE_GRAMS = 31.10348
UPDATE_INTERVAL = 300  # 5 minutes in seconds
EXCHANGE_RATE_UPDATE_INTERVAL = 3600  # 1 hour in seconds

# Global data storage
current_data = None
data_lock = threading.Lock()
last_fetch_time = 0
last_exchange_rate_fetch = 0
shanghai_retry_count = 0
shutdown_event = threading.Event()

# Initialize database
def init_database():
    conn = sqlite3.connect('shanghai_silver.db')
    
    # Create tables
    conn.execute('''CREATE TABLE IF NOT EXISTS prices 
                    (timestamp TEXT PRIMARY KEY, price_cny REAL, price_usd REAL, usd_cny_rate REAL)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS api_requests 
                    (date TEXT PRIMARY KEY, alpha_vantage_count INTEGER DEFAULT 0)''')
    
    conn.commit()
    conn.close()

def get_cached_exchange_rate():
    """Get most recent exchange rate from database"""
    try:
        conn = sqlite3.connect('shanghai_silver.db')
        cursor = conn.cursor()
        cursor.execute('SELECT usd_cny_rate FROM prices WHERE usd_cny_rate IS NOT NULL ORDER BY timestamp DESC LIMIT 1')
        result = cursor.fetchone()
        conn.close()
        return result[0] if result else USD_CNY_RATE
    except Exception as e:
        logger.error(f"Failed to get cached exchange rate: {e}")
        return USD_CNY_RATE

def can_make_api_request():
    """Check if we can make an Alpha Vantage API request today"""
    try:
        conn = sqlite3.connect('shanghai_silver.db')
        cursor = conn.cursor()
        today = datetime.now().date().isoformat()
        cursor.execute('SELECT alpha_vantage_count FROM api_requests WHERE date = ?', (today,))
        result = cursor.fetchone()
        count = result[0] if result else 0
        conn.close()
        return count < 24
    except Exception:
        return True

def increment_api_request_count():
    """Increment today's API request count"""
    try:
        conn = sqlite3.connect('shanghai_silver.db')
        today = datetime.now().date().isoformat()
        conn.execute('INSERT OR IGNORE INTO api_requests (date, alpha_vantage_count) VALUES (?, 0)', (today,))
        conn.execute('UPDATE api_requests SET alpha_vantage_count = alpha_vantage_count + 1 WHERE date = ?', (today,))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to increment API count: {e}")

def validate_exchange_rate(new_rate, current_rate):
    """Validate exchange rate is within reasonable bounds"""
    if new_rate <= 0:
        return False
    change = abs(new_rate - current_rate) / current_rate
    return change <= 1.0  # Max 100% change

def validate_silver_price(new_price, current_price):
    """Validate silver price is within reasonable bounds"""
    if new_price <= 0:
        return False
    if current_price <= 0:
        return True  # First price, accept it
    change = abs(new_price - current_price) / current_price
    return change <= 1.0  # Max 100% change

def fetch_exchange_rate():
    """Fetch USD/CNY exchange rate from Alpha Vantage API"""
    global USD_CNY_RATE
    try:
        if not can_make_api_request():
            logger.info("API request limit reached, using cached rate")
            USD_CNY_RATE = get_cached_exchange_rate()
            return USD_CNY_RATE
            
        api_key = os.environ.get('ALPHA_VANTAGE_API_KEY')
        if not api_key:
            logger.warning("No Alpha Vantage API key found, using cached rate")
            USD_CNY_RATE = get_cached_exchange_rate()
            return USD_CNY_RATE
            
        url = f'https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=USD&to_currency=CNY&apikey={api_key}'
        response = requests.get(url, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if 'Realtime Currency Exchange Rate' in data:
                new_rate = float(data['Realtime Currency Exchange Rate']['5. Exchange Rate'])
                
                if validate_exchange_rate(new_rate, USD_CNY_RATE):
                    increment_api_request_count()
                    USD_CNY_RATE = new_rate
                    logger.info(f"Updated USD/CNY rate: {new_rate}")
                    return new_rate
                else:
                    logger.warning(f"Invalid exchange rate {new_rate}, using cached rate")
                    USD_CNY_RATE = get_cached_exchange_rate()
                    return USD_CNY_RATE
        
        logger.warning("Failed to fetch exchange rate, using cached rate")
        USD_CNY_RATE = get_cached_exchange_rate()
        return USD_CNY_RATE
        
    except Exception as e:
        logger.error(f"Exchange rate fetch error: {e}")
        USD_CNY_RATE = get_cached_exchange_rate()
        return USD_CNY_RATE

def filter_times(times, prices):
    """Filter data based on last updated time"""
    # Get last timestamp from data
    last_update_time = times[-1] if times else "N/A"
    if times:
        last_hour, last_minute = map(int, last_update_time.split(':'))
        last_time_minutes = last_hour * 60 + last_minute
    else:
        return times, prices
    
    filtered_times = []
    filtered_prices = []
    
    for i, time_str in enumerate(times):
        hour, minute = map(int, time_str.split(':'))
        data_time_minutes = hour * 60 + minute
        
        # Handle day rollover
        if hour < 20:
            data_time_minutes += 24 * 60
        if last_time_minutes < 20 * 60:
            last_time_minutes += 24 * 60
        
        # Keep data up to last update time
        if data_time_minutes <= last_time_minutes:
            filtered_times.append(time_str)
            filtered_prices.append(prices[i])
    
    return filtered_times, filtered_prices

def enrich_data(prices):
    """Convert CNY/kg to USD/troy ounce"""
    return [(p / 1000) * TROY_OUNCE_GRAMS / USD_CNY_RATE for p in prices]
def store_data(times, prices, usd_prices):
    conn = sqlite3.connect('shanghai_silver.db')
    shanghai_tz = pytz.timezone('Asia/Shanghai')
    today = datetime.now(shanghai_tz).date()
    
    for time_str, price, usd_price in zip(times, prices, usd_prices):
        if np.isnan(price):
            continue
        hour, minute = map(int, time_str.split(':'))
        # Handle overnight trading (before 6 AM is next day)
        if hour < 6:
            dt = datetime.combine(today, datetime.min.time().replace(hour=hour, minute=minute)) + pd.Timedelta(days=1)
        else:
            dt = datetime.combine(today, datetime.min.time().replace(hour=hour, minute=minute))
        
        timestamp = shanghai_tz.localize(dt).isoformat()
        conn.execute('INSERT OR REPLACE INTO prices VALUES (?, ?, ?, ?)', 
                    (timestamp, price, usd_price, USD_CNY_RATE))
    
    conn.commit()
    conn.close()

def fetch_data_background():
    """Fetch data from API in background thread"""
    global current_data, last_fetch_time, last_exchange_rate_fetch, shanghai_retry_count
    
    # Fetch initial exchange rate
    fetch_exchange_rate()
    last_exchange_rate_fetch = time.time()
    
    while not shutdown_event.is_set():
        try:
            current_time = time.time()
            
            # Check if we need to update exchange rate (every hour)
            if current_time - last_exchange_rate_fetch >= EXCHANGE_RATE_UPDATE_INTERVAL:
                fetch_exchange_rate()
                last_exchange_rate_fetch = current_time
            
            if current_time - last_fetch_time < UPDATE_INTERVAL:
                time.sleep(1)
                continue
                
            # Fetch Shanghai Silver data
            response = requests.post(
                'https://en.sge.com.cn/graph/quotations',
                headers={
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Origin': 'https://en.sge.com.cn',
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
                },
                data='instid=Ag(T%2BD)',
                timeout=10
            )

            if response.status_code != 200 or not response.text.strip():
                # Try with more complete headers
                response = requests.post(
                    'https://en.sge.com.cn/graph/quotations',
                    headers={
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'Origin': 'https://en.sge.com.cn',
                        'Referer': 'https://en.sge.com.cn/',
                        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    data='instid=Ag(T%2BD)',
                    timeout=10
                )

            if response.status_code == 200 and response.text.strip():
                data = response.json()
                
                # ETL Pipeline: Fetch -> Filter -> Enrich -> Store
                raw_times = data['times']
                raw_prices = [float(p) for p in data['data']]
                
                # Validate prices if we have previous data
                if current_data and raw_prices:
                    prev_prices = [float(p) for p in current_data['data']]
                    if prev_prices:
                        last_price = prev_prices[-1]
                        if not validate_silver_price(raw_prices[-1], last_price):
                            logger.warning(f"Invalid silver price {raw_prices[-1]}, skipping update")
                            continue
                
                # Filter times
                filtered_times, filtered_prices = filter_times(raw_times, raw_prices)
                
                # Enrich data
                usd_prices = enrich_data(filtered_prices)
                
                # Store in database
                store_data(filtered_times, filtered_prices, usd_prices)
                
                # Update global data for display
                data['times'] = filtered_times
                data['data'] = [str(p) for p in filtered_prices]
                
                with data_lock:
                    current_data = data
                    last_fetch_time = current_time
                
                shanghai_retry_count = 0  # Reset retry count on success
                logger.info(f"Data updated at {datetime.now().strftime('%H:%M:%S')}")
            else:
                raise requests.RequestException("Empty response")
                
        except requests.RequestException as e:
            shanghai_retry_count += 1
            backoff_time = min(5 * (2 ** (shanghai_retry_count - 1)), 300)  # Max 5 minutes
            logger.error(f"API request failed (attempt {shanghai_retry_count}): {e}")
            logger.info(f"Retrying in {backoff_time} seconds...")
            time.sleep(backoff_time)
        except Exception as e:
            logger.error(f"Data fetch error: {type(e).__name__}: {e}")
            time.sleep(5)

def create_candlesticks(times, prices):
    """Convert 1-minute data to 5-minute candlesticks"""
    candles = []
    candle_times = []
    
    for i in range(0, len(times), 5):
        # Get 5-minute window
        window_prices = prices[i:i+5]
        window_times = times[i:i+5]
        
        if len(window_prices) == 0:
            continue
            
        # Remove NaN values
        valid_prices = [p for p in window_prices if not np.isnan(p)]
        
        if len(valid_prices) == 0:
            candles.append([np.nan, np.nan, np.nan, np.nan])
            candle_times.append(window_times[0])
            continue
        
        # OHLC for this 5-minute period
        open_price = valid_prices[0]
        close_price = valid_prices[-1]
        high_price = max(valid_prices)
        low_price = min(valid_prices)
        
        candles.append([open_price, high_price, low_price, close_price])
        candle_times.append(window_times[0])  # Use first timestamp of the period
    
    return candle_times, candles

def plot_candlesticks(ax, times, candles, color_up='g', color_down='r'):
    """Plot candlesticks on given axis"""
    for i, (time_str, ohlc) in enumerate(zip(times, candles)):
        if any(np.isnan(ohlc)):
            continue
            
        open_price, high_price, low_price, close_price = ohlc
        
        # Determine color
        color = color_up if close_price >= open_price else color_down
        
        # Draw the high-low line (wick) first so it's behind the candle body
        ax.plot([i, i], [low_price, high_price], color='white', linewidth=1, zorder=1)
        
        # Draw the open-close rectangle on top
        height = abs(close_price - open_price)
        bottom = min(open_price, close_price)
        
        rect = plt.Rectangle((i-0.3, bottom), 0.6, height, 
                           facecolor=color, edgecolor='none', alpha=1.0, zorder=2)
        ax.add_patch(rect)

def update_plot(frame):
    """Update plot function called by FuncAnimation"""
    global current_data
    
    with data_lock:
        if current_data is None:
            return
        data = current_data.copy()

    times = data['times']
    prices = [float(p) for p in data['data']]

    # Convert CNY/kg to USD/troy ounce (data is already filtered and enriched)
    usd_prices = [(p / 1000) * TROY_OUNCE_GRAMS / USD_CNY_RATE for p in prices]

    # Get last timestamp for display
    last_update_time = times[-1] if times else "N/A"

    # Apply display filtering (remove repeated values at end)
    filtered_prices = prices.copy()
    filtered_usd_prices = usd_prices.copy()

    # Remove repeated values at the end from original data
    if len(prices) > 5:
        last_original_price = prices[-1]
        consecutive_count = 0
        for i in range(len(prices) - 1, -1, -1):
            if prices[i] == last_original_price:
                consecutive_count += 1
            else:
                break
        
        if consecutive_count > 3:
            for i in range(len(prices) - consecutive_count, len(prices)):
                filtered_prices[i] = np.nan
                filtered_usd_prices[i] = np.nan

    # Create 5-minute candlesticks
    candle_times, cny_candles = create_candlesticks(times, filtered_prices)
    _, usd_candles = create_candlesticks(times, filtered_usd_prices)

    # Clear and redraw
    plt.clf()
    
    # Create chart with dual y-axes
    ax1 = plt.gca()

    # Create second y-axis first
    ax2 = ax1.twinx()
    ax2.set_ylabel('USD/ozt', color='white')
    ax2.tick_params(axis='y', labelcolor='white')
    
    # Format USD axis with $ prefix
    ax2.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'${x:.2f}'))

    # Plot candlesticks for CNY on top
    plot_candlesticks(ax1, candle_times, cny_candles, color_up='lightgreen', color_down='lightcoral')
    ax1.set_ylabel('CNY/kg', color='white')
    ax1.tick_params(axis='y', labelcolor='white')
    
    # Format CNY axis with ¥ prefix
    ax1.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'¥{x:.0f}'))

    # Add trading session shading
    night_start = night_end = day_start = day_end = None
    for i, time_str in enumerate(candle_times):
        hour = int(time_str.split(':')[0])
        if hour == 20 and night_start is None:
            night_start = i
        elif hour == 2 and night_end is None and night_start is not None:
            night_end = i
        elif hour == 9 and day_start is None:
            day_start = i
        elif hour == 15 and day_end is None and day_start is not None:
            day_end = i

    if night_start is not None and night_end is not None:
        ax1.axvspan(night_start-0.5, night_end+0.5, alpha=0.1, color='blue')
    if day_start is not None and day_end is not None:
        ax1.axvspan(day_start-0.5, day_end+0.5, alpha=0.1, color='orange')

    # Find max/min values from valid candles and set y-axis limits
    valid_cny_highs = [c[1] for c in cny_candles if not np.isnan(c[1])]
    valid_cny_lows = [c[2] for c in cny_candles if not np.isnan(c[2])]
    valid_usd_highs = [c[1] for c in usd_candles if not np.isnan(c[1])]
    valid_usd_lows = [c[2] for c in usd_candles if not np.isnan(c[2])]
    
    if valid_cny_highs:
        max_cny = max(valid_cny_highs)
        min_cny = min(valid_cny_lows)
        max_usd = max(valid_usd_highs)
        min_usd = min(valid_usd_lows)
        
        # Add 10% padding above and below
        cny_range = max_cny - min_cny
        
        ax1.set_ylim(min_cny - cny_range * 0.1, max_cny + cny_range * 0.1)
        
        # Set USD axis to match CNY axis using exchange rate conversion
        cny_min, cny_max = ax1.get_ylim()
        usd_min = (cny_min / 1000) * TROY_OUNCE_GRAMS / USD_CNY_RATE
        usd_max = (cny_max / 1000) * TROY_OUNCE_GRAMS / USD_CNY_RATE
        ax2.set_ylim(usd_min, usd_max)
        
        max_idx = next(i for i, c in enumerate(cny_candles) if c[1] == max_cny)
        max_time = candle_times[max_idx]
    else:
        max_cny = max_usd = 0
        max_time = "N/A"

    plt.title(f'Shanghai Silver (Ag T+D) 5-Min Candlestick Chart -- Last updated: {last_update_time} CST\nUSD/CNY: {USD_CNY_RATE}, ozt: {TROY_OUNCE_GRAMS}g -- High: ¥{max_cny:.0f} ${max_usd:.2f} at {max_time}')
    plt.grid(True, alpha=0.3)

    # Show time labels
    step = max(1, len(candle_times) // 10)
    ax1.set_xticks(range(0, len(candle_times), step))
    ax1.set_xticklabels([candle_times[i] for i in range(0, len(candle_times), step)])

    plt.tight_layout()

def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    logger.info(f"Received signal {signum}, shutting down gracefully...")
    shutdown_event.set()
    plt.close('all')
    sys.exit(0)

# Initialize database
init_database()

# Set up signal handlers
signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Start background data fetching thread
data_thread = threading.Thread(target=fetch_data_background, daemon=True)
data_thread.start()

# Wait for initial data
logger.info("Waiting for initial data...")
while current_data is None and not shutdown_event.is_set():
    time.sleep(0.1)

# Create figure and animation
fig = plt.figure(figsize=(14, 8))
ani = FuncAnimation(fig, update_plot, interval=250, cache_frame_data=False)  # Update every 100ms

# Show plot
plt.show()
