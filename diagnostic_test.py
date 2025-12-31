#!/usr/bin/env python3
"""
Diagnostic script to test chart redrawing improvements.

Usage examples:
  # Test with 2-minute price buffer
  PRICE_BUFFER_MIN=2 DEBUG=1 python3 diagnostic_test.py

  # Test with custom stale data threshold
  STALE_DATA_THRESHOLD_MIN=10 DEBUG=1 python3 diagnostic_test.py

  # Monitor latest DB entries for retroactive updates
  python3 diagnostic_test.py --monitor
"""

import argparse
import os
import sqlite3
import time
from datetime import datetime

import pytz

SH_TZ = pytz.timezone("Asia/Shanghai")


def monitor_latest_entries(db_path="shanghai_metals.db", interval=30):
    """Monitor latest DB entries to detect retroactive price updates."""
    print(f"Monitoring {db_path} for retroactive updates every {interval}s...")
    print("Press Ctrl+C to stop\n")

    conn = sqlite3.connect(db_path)
    last_entries = {}

    try:
        while True:
            # Get latest entry for each metal
            for metal in ["gold", "silver"]:
                row = conn.execute(
                    "SELECT timestamp, price_cny FROM prices "
                    "WHERE metal = ? ORDER BY timestamp DESC LIMIT 1",
                    (metal,),
                ).fetchone()

                if row:
                    ts, price = row
                    key = f"{metal}:{ts}"

                    if key in last_entries:
                        if last_entries[key] != price:
                            print(
                                f"🔄 RETROACTIVE UPDATE: {metal} {ts} "
                                f"{last_entries[key]:.4f} → {price:.4f}"
                            )
                    else:
                        print(f"📊 {metal} latest: {ts} = {price:.4f}")

                    last_entries[key] = price

            time.sleep(interval)

    except KeyboardInterrupt:
        print("\nMonitoring stopped.")
    finally:
        conn.close()


def test_collector_with_settings():
    """Test collector with current environment settings."""
    buffer_min = int(os.environ.get("PRICE_BUFFER_MIN", "0"))
    stale_threshold = int(os.environ.get("STALE_DATA_THRESHOLD_MIN", "5"))
    debug = bool(os.environ.get("DEBUG"))

    print("Current diagnostic settings:")
    print(f"  PRICE_BUFFER_MIN: {buffer_min} minutes")
    print(f"  STALE_DATA_THRESHOLD_MIN: {stale_threshold} minutes")
    print(f"  DEBUG logging: {debug}")
    print()

    if buffer_min > 0:
        print(
            f"⏰ Price buffer enabled: latest {buffer_min} minute(s) "
            "will be delayed to avoid provisional prices"
        )

    if debug:
        print("🔍 Debug logging enabled - watch for detailed cutoff info")

    print("\nRun collector.py with these settings to test improvements.")


def main():
    parser = argparse.ArgumentParser(description="Diagnostic tools for collector")
    parser.add_argument(
        "--monitor",
        action="store_true",
        help="Monitor DB for retroactive price updates",
    )
    parser.add_argument(
        "--db", default="shanghai_metals.db", help="Database path"
    )
    parser.add_argument(
        "--interval", type=int, default=30, help="Monitor interval in seconds"
    )

    args = parser.parse_args()

    if args.monitor:
        monitor_latest_entries(args.db, args.interval)
    else:
        test_collector_with_settings()


if __name__ == "__main__":
    main()
