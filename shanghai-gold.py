#!/usr/bin/env python3
from shanghai_base import ShanghaiMetalChart

# Gold-specific configuration
config = {
    'usd_cny_rate': 7.0060,
    'troy_ounce_grams': 31.10348,
    'update_interval': 300,
    'exchange_rate_update_interval': 3600,
    'shanghai_timezone': 'Asia/Shanghai',
    'animation_interval': 250,
    'candle_width': 0.6,
    'chart_padding': 0.1,
    'chart_figsize': (14, 8),
    'chart_export_filename': 'gold.png',
    'database_name': 'shanghai_gold.db',
    'api_instrument': 'Au(T%2BD)',
    'chart_title': 'Shanghai Gold (Au T+D)',
    'cny_unit_label': 'CNY/g',
    'cny_precision': 2,  # 2 decimal places
    'usd_precision': 0,  # Integer display
    'price_converter': lambda p: p,  # Already CNY/gram
}

if __name__ == "__main__":
    chart = ShanghaiMetalChart(config)
    chart.run()
