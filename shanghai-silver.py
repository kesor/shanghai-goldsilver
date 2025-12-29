#!/usr/bin/env python3
from shanghai_base import ShanghaiMetalChart

# Silver-specific configuration
config = {
    'usd_cny_rate': 7.0060,
    'troy_ounce_grams': 31.10348,
    'update_interval': 60,
    'exchange_rate_update_interval': 3600,
    'shanghai_timezone': 'Asia/Shanghai',
    'animation_interval': 250,
    'candle_width': 0.6,
    'chart_padding': 0.1,
    'chart_figsize': (14, 8),
    'chart_export_filename': 'silver.png',
    'database_name': 'shanghai_silver.db',
    'api_instrument': 'Ag(T%2BD)',
    'chart_title': 'Shanghai Silver (Ag T+D)',
    'cny_unit_label': 'CNY/kg',
    'cny_precision': 0,  # Integer display
    'usd_precision': 2,  # 2 decimal places
    'price_converter': lambda p: p / 1000,  # CNY/kg to CNY/gram
}

if __name__ == "__main__":
    chart = ShanghaiMetalChart(config)
    chart.run()
