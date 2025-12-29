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
import tempfile

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Set dark theme
plt.style.use('dark_background')
plt.rcParams['toolbar'] = 'None'

class ShanghaiMetalChart:
    def __init__(self, config):
        # Configuration
        self.USD_CNY_RATE = config['usd_cny_rate']
        self.TROY_OUNCE_GRAMS = config['troy_ounce_grams']
        self.UPDATE_INTERVAL = config['update_interval']
        self.EXCHANGE_RATE_UPDATE_INTERVAL = config['exchange_rate_update_interval']
        self.SHANGHAI_TIMEZONE = config['shanghai_timezone']
        
        # Chart configuration
        self.ANIMATION_INTERVAL = config['animation_interval']
        self.CANDLE_WIDTH = config['candle_width']
        self.CHART_PADDING = config['chart_padding']
        self.CHART_FIGSIZE = config['chart_figsize']
        self.CHART_EXPORT_FILENAME = config['chart_export_filename']
        
        # Metal-specific configuration
        self.DATABASE_NAME = config['database_name']
        self.API_INSTRUMENT = config['api_instrument']
        self.CHART_TITLE = config['chart_title']
        self.CNY_UNIT_LABEL = config['cny_unit_label']
        self.CNY_PRECISION = config['cny_precision']
        self.USD_PRECISION = config['usd_precision']
        self.PRICE_CONVERTER = config['price_converter']
        
        # Global data storage
        self.current_data = None
        self.data_lock = threading.Lock()
        self.exchange_rate_lock = threading.Lock()
        self.last_fetch_time = 0
        self.last_exchange_rate_fetch = 0
        self.shanghai_retry_count = 0
        self.shutdown_event = threading.Event()
        self.db_conn = None
        self.fig = None
        
    def init_database(self):
        self.db_conn = sqlite3.connect(self.DATABASE_NAME, check_same_thread=False)
        
        # Create tables
        self.db_conn.execute('''CREATE TABLE IF NOT EXISTS prices 
                        (timestamp TEXT PRIMARY KEY, price_cny REAL, price_usd REAL, usd_cny_rate REAL)''')
        self.db_conn.execute('''CREATE TABLE IF NOT EXISTS api_requests 
                        (date TEXT PRIMARY KEY, alpha_vantage_count INTEGER DEFAULT 0)''')
        
        self.db_conn.commit()

    def close_database(self):
        if self.db_conn:
            self.db_conn.close()
            self.db_conn = None

    def get_cached_exchange_rate(self):
        try:
            cursor = self.db_conn.cursor()
            cursor.execute('SELECT usd_cny_rate FROM prices WHERE usd_cny_rate IS NOT NULL ORDER BY timestamp DESC LIMIT 1')
            result = cursor.fetchone()
            return result[0] if result else self.USD_CNY_RATE
        except Exception as e:
            logger.error(f"Failed to get cached exchange rate: {e}")
            return self.USD_CNY_RATE

    def can_make_api_request(self):
        try:
            cursor = self.db_conn.cursor()
            today = datetime.now().date().isoformat()
            cursor.execute('SELECT alpha_vantage_count FROM api_requests WHERE date = ?', (today,))
            result = cursor.fetchone()
            count = result[0] if result else 0
            return count < 24
        except Exception:
            return True

    def increment_api_request_count(self):
        try:
            today = datetime.now().date().isoformat()
            self.db_conn.execute('INSERT OR IGNORE INTO api_requests (date, alpha_vantage_count) VALUES (?, 0)', (today,))
            self.db_conn.execute('UPDATE api_requests SET alpha_vantage_count = alpha_vantage_count + 1 WHERE date = ?', (today,))
            self.db_conn.commit()
        except Exception as e:
            logger.error(f"Failed to increment API count: {e}")

    def validate_exchange_rate(self, new_rate, current_rate):
        if new_rate <= 0:
            return False
        change = abs(new_rate - current_rate) / current_rate
        return change <= 1.0

    def validate_silver_price(self, new_price, current_price):
        if new_price <= 0:
            return False
        if current_price <= 0:
            return True
        change = abs(new_price - current_price) / current_price
        return change <= 1.0

    def fetch_exchange_rate(self):
        try:
            if not self.can_make_api_request():
                logger.info("API request limit reached, using cached rate")
                with self.exchange_rate_lock:
                    self.USD_CNY_RATE = self.get_cached_exchange_rate()
                return self.USD_CNY_RATE
                
            api_key = os.environ.get('ALPHA_VANTAGE_API_KEY')
            if not api_key:
                logger.warning("No Alpha Vantage API key found, using cached rate")
                with self.exchange_rate_lock:
                    self.USD_CNY_RATE = self.get_cached_exchange_rate()
                return self.USD_CNY_RATE
                
            url = f'https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=USD&to_currency=CNY&apikey={api_key}'
            response = requests.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if 'Realtime Currency Exchange Rate' in data:
                    new_rate = float(data['Realtime Currency Exchange Rate']['5. Exchange Rate'])
                    
                    with self.exchange_rate_lock:
                        if self.validate_exchange_rate(new_rate, self.USD_CNY_RATE):
                            self.increment_api_request_count()
                            self.USD_CNY_RATE = new_rate
                            logger.info(f"Updated USD/CNY rate: {new_rate}")
                            return new_rate
                        else:
                            logger.warning(f"Invalid exchange rate {new_rate}, using cached rate")
                            self.USD_CNY_RATE = self.get_cached_exchange_rate()
                            return self.USD_CNY_RATE
            
            logger.warning("Failed to fetch exchange rate, using cached rate")
            with self.exchange_rate_lock:
                self.USD_CNY_RATE = self.get_cached_exchange_rate()
            return self.USD_CNY_RATE
            
        except Exception as e:
            logger.error(f"Exchange rate fetch error: {e}")
            with self.exchange_rate_lock:
                self.USD_CNY_RATE = self.get_cached_exchange_rate()
            return self.USD_CNY_RATE

    def filter_times(self, times, prices):
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
            
            if hour < 20:
                data_time_minutes += 24 * 60
            if last_time_minutes < 20 * 60:
                last_time_minutes += 24 * 60
            
            if data_time_minutes <= last_time_minutes:
                filtered_times.append(time_str)
                filtered_prices.append(prices[i])
        
        return filtered_times, filtered_prices

    def enrich_data(self, prices):
        with self.exchange_rate_lock:
            rate = self.USD_CNY_RATE
        return [self.PRICE_CONVERTER(p) * self.TROY_OUNCE_GRAMS / rate for p in prices]

    def store_data(self, times, prices, usd_prices):
        shanghai_tz = pytz.timezone(self.SHANGHAI_TIMEZONE)
        today = datetime.now(shanghai_tz).date()
        
        with self.exchange_rate_lock:
            current_rate = self.USD_CNY_RATE
        
        for time_str, price, usd_price in zip(times, prices, usd_prices):
            if np.isnan(price):
                continue
            hour, minute = map(int, time_str.split(':'))
            if hour < 6:
                dt = datetime.combine(today, datetime.min.time().replace(hour=hour, minute=minute)) + pd.Timedelta(days=1)
            else:
                dt = datetime.combine(today, datetime.min.time().replace(hour=hour, minute=minute))
            
            timestamp = shanghai_tz.localize(dt).isoformat()
            self.db_conn.execute('INSERT OR REPLACE INTO prices VALUES (?, ?, ?, ?)', 
                        (timestamp, price, usd_price, current_rate))
        
        self.db_conn.commit()

    def create_candlesticks(self, times, prices):
        candles = []
        candle_times = []
        
        i = 0
        while i < len(times):
            window_end = min(i + 5, len(times))
            window_prices = prices[i:window_end]
            window_times = times[i:window_end]
            
            if len(window_prices) == 0:
                break
                
            valid_prices = [p for p in window_prices if not np.isnan(p)]
            
            if len(valid_prices) == 0:
                candles.append([np.nan, np.nan, np.nan, np.nan])
                candle_times.append(window_times[0])
            else:
                open_price = valid_prices[0]
                close_price = valid_prices[-1]
                high_price = max(valid_prices)
                low_price = min(valid_prices)
                
                candles.append([open_price, high_price, low_price, close_price])
                candle_times.append(window_times[0])
            
            i += 5
        
        return candle_times, candles

    def plot_candlesticks(self, ax, times, candles, color_up='g', color_down='r'):
        for i, (time_str, ohlc) in enumerate(zip(times, candles)):
            if any(np.isnan(ohlc)):
                continue
                
            open_price, high_price, low_price, close_price = ohlc
            
            color = color_up if close_price >= open_price else color_down
            
            ax.plot([i, i], [low_price, high_price], color='white', linewidth=1, zorder=1)
            
            height = abs(close_price - open_price)
            bottom = min(open_price, close_price)
            
            rect = plt.Rectangle((i-self.CANDLE_WIDTH/2, bottom), self.CANDLE_WIDTH, height, 
                               facecolor=color, edgecolor='none', alpha=1.0, zorder=2)
            ax.add_patch(rect)

    def fetch_data_background(self):
        self.fetch_exchange_rate()
        self.last_exchange_rate_fetch = time.time()
        
        while not self.shutdown_event.is_set():
            try:
                current_time = time.time()
                
                if current_time - self.last_exchange_rate_fetch >= self.EXCHANGE_RATE_UPDATE_INTERVAL:
                    self.fetch_exchange_rate()
                    self.last_exchange_rate_fetch = current_time
                
                if current_time - self.last_fetch_time < self.UPDATE_INTERVAL:
                    time.sleep(1)
                    continue
                    
                response = requests.post(
                    'https://en.sge.com.cn/graph/quotations',
                    headers={
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'Origin': 'https://en.sge.com.cn',
                        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
                    },
                    data='instid=' + self.API_INSTRUMENT,
                    timeout=10
                )

                if response.status_code != 200 or not response.text.strip():
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
                        data='instid=' + self.API_INSTRUMENT,
                        timeout=10
                    )

                if response.status_code == 200 and response.text.strip():
                    data = response.json()
                    
                    raw_times = data['times']
                    raw_prices = [float(p) for p in data['data']]
                    
                    if self.current_data and raw_prices:
                        prev_prices = [float(p) for p in self.current_data['data']]
                        if prev_prices:
                            last_price = prev_prices[-1]
                            if not self.validate_silver_price(raw_prices[-1], last_price):
                                logger.warning(f"Invalid price {raw_prices[-1]}, skipping update")
                                continue
                    
                    filtered_times, filtered_prices = self.filter_times(raw_times, raw_prices)
                    usd_prices = self.enrich_data(filtered_prices)
                    self.store_data(filtered_times, filtered_prices, usd_prices)
                    
                    data['times'] = filtered_times
                    data['data'] = [str(p) for p in filtered_prices]
                    
                    with self.data_lock:
                        self.current_data = data
                        self.last_fetch_time = current_time
                    
                    self.shanghai_retry_count = 0
                    logger.info(f"Data updated at {datetime.now().strftime('%H:%M:%S')}")
                    
                    # Save chart as PNG atomically when new data arrives
                    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as temp_file:
                        self.fig.savefig(temp_file.name, dpi=150, bbox_inches='tight')
                        temp_name = temp_file.name
                    os.rename(temp_name, self.CHART_EXPORT_FILENAME)
                else:
                    raise requests.RequestException("Empty response")
                    
            except requests.RequestException as e:
                self.shanghai_retry_count += 1
                backoff_time = min(5 * (2 ** (self.shanghai_retry_count - 1)), 300)
                logger.error(f"API request failed (attempt {self.shanghai_retry_count}): {e}")
                logger.info(f"Retrying in {backoff_time} seconds...")
                time.sleep(backoff_time)
            except Exception as e:
                logger.error(f"Data fetch error: {type(e).__name__}: {e}")
                time.sleep(5)

    def update_plot(self, frame):
        with self.data_lock:
            if self.current_data is None:
                return
            data = self.current_data.copy()

        times = data['times']
        prices = [float(p) for p in data['data']]
        last_update_time = times[-1] if times else "N/A"

        filtered_prices = self.filter_repeated_prices(prices)
        candle_times, cny_candles = self.create_candlesticks(times, filtered_prices)

        plt.clf()
        
        ax1 = plt.gca()
        ax2 = self.setup_axes(ax1)

        self.plot_candlesticks(ax1, candle_times, cny_candles, color_up='lightgreen', color_down='lightcoral')
        self.add_trading_sessions(ax1, candle_times)
        self.setup_axis_limits(ax1, ax2, cny_candles)
        
        with self.exchange_rate_lock:
            current_rate = self.USD_CNY_RATE

        max_cny, max_usd, max_time = self.calculate_max_values(cny_candles, candle_times)

        plt.title(f'{self.CHART_TITLE} 5-Min Candlestick Chart -- Last updated: {last_update_time} CST\nUSD/CNY: {current_rate}, ozt: {self.TROY_OUNCE_GRAMS}g -- High: ¥{max_cny:.{self.CNY_PRECISION}f} ${max_usd:.{self.USD_PRECISION}f} at {max_time}')
        ax1.grid(True, alpha=0.3, axis='y')

        self.setup_time_labels(ax1, candle_times)
        plt.tight_layout()

    def filter_repeated_prices(self, prices):
        filtered_prices = prices.copy()
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
        return filtered_prices

    def setup_axes(self, ax1):
        ax1.set_ylabel(self.CNY_UNIT_LABEL, color='white')
        ax1.tick_params(axis='y', labelcolor='white')
        ax1.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'¥{x:.{self.CNY_PRECISION}f}'))
        
        ax1.text(1.05, 0.5, 'USD/ozt', transform=ax1.transAxes, rotation=90, 
                 verticalalignment='center', color='white')
        
        return ax1

    def add_trading_sessions(self, ax1, candle_times):
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

    def setup_axis_limits(self, ax1, ax2, cny_candles):
        valid_cny_highs = [c[1] for c in cny_candles if not np.isnan(c[1])]
        valid_cny_lows = [c[2] for c in cny_candles if not np.isnan(c[2])]
        
        if valid_cny_highs:
            max_cny = max(valid_cny_highs)
            min_cny = min(valid_cny_lows)
            
            cny_range = max_cny - min_cny
            cny_min = min_cny - cny_range * self.CHART_PADDING
            cny_max = max_cny + cny_range * self.CHART_PADDING
            ax1.set_ylim(cny_min, cny_max)
            
            import matplotlib.ticker as ticker
            ax1.yaxis.set_major_locator(ticker.MaxNLocator(nbins=8, prune='both'))
            
            cny_ticks = ax1.get_yticks()
            
            with self.exchange_rate_lock:
                rate = self.USD_CNY_RATE
            
            for cny_tick in cny_ticks:
                if cny_min <= cny_tick <= cny_max:
                    usd_value = self.PRICE_CONVERTER(cny_tick) * self.TROY_OUNCE_GRAMS / rate
                    ax1.text(1.01, (cny_tick - cny_min) / (cny_max - cny_min), f'${usd_value:.{self.USD_PRECISION}f}', 
                            transform=ax1.transAxes, verticalalignment='center', 
                            horizontalalignment='left', color='white')

    def calculate_max_values(self, cny_candles, candle_times):
        valid_cny_highs = [c[1] for c in cny_candles if not np.isnan(c[1])]
        if valid_cny_highs:
            max_cny = max(valid_cny_highs)
            max_usd = self.PRICE_CONVERTER(max_cny) * self.TROY_OUNCE_GRAMS / self.USD_CNY_RATE
            max_idx = next(i for i, c in enumerate(cny_candles) if c[1] == max_cny)
            max_time = candle_times[max_idx]
            return max_cny, max_usd, max_time
        return 0, 0, "N/A"

    def setup_time_labels(self, ax1, candle_times):
        step = max(1, len(candle_times) // 10)
        ax1.set_xticks(range(0, len(candle_times), step))
        ax1.set_xticklabels([candle_times[i] for i in range(0, len(candle_times), step)])

    def signal_handler(self, signum, frame):
        logger.info(f"Received signal {signum}, shutting down gracefully...")
        self.shutdown_event.set()
        self.close_database()
        plt.close('all')
        sys.exit(0)

    def run(self):
        self.init_database()
        
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)
        
        data_thread = threading.Thread(target=self.fetch_data_background, daemon=True)
        data_thread.start()
        
        logger.info("Waiting for initial data...")
        while self.current_data is None and not self.shutdown_event.is_set():
            time.sleep(0.1)

        self.fig = plt.figure(figsize=self.CHART_FIGSIZE)
        ani = FuncAnimation(self.fig, self.update_plot, interval=self.ANIMATION_INTERVAL, cache_frame_data=False)
        
        plt.show()
