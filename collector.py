#!/usr/bin/env python3
import json
import logging
import os
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import date, datetime
from datetime import time as dtime
from datetime import timedelta, timezone

import pytz  # type: ignore
import requests

LOG = logging.getLogger("collector")

_DELAY_RE = re.compile(
    r"^\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2}):(\d{2})\s*$"
)
SGE_URL = "https://en.sge.com.cn/graph/quotations"
SH_TZ = pytz.timezone("Asia/Shanghai")

FX_DEFAULT = 7.0060
FETCH_INTERVAL_SEC = 60
FX_REFRESH_SEC = 3600


@dataclass(frozen=True)
class Instrument:
    metal: str  # "gold" | "silver"
    instid: str  # e.g. "Au(T%2BD)"
    unit: str  # "CNY/g" or "CNY/kg"


INSTRUMENTS = [
    Instrument(metal="gold", instid="Au(T%2BD)", unit="CNY/g"),
    Instrument(metal="silver", instid="Ag(T%2BD)", unit="CNY/kg"),
]


def http_headers():
    """Return HTTP headers for SGE API requests."""
    return {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": "https://en.sge.com.cn",
        "Referer": "https://en.sge.com.cn/",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "X-Requested-With": "XMLHttpRequest",
    }


def trading_day_start_date_sh(now_sh: datetime) -> date:
    """Get the trading day start date (20:00 Shanghai time marks new trading day)."""
    # trading day starts at 20:00 Shanghai wall time
    if now_sh.time() >= dtime(20, 0):
        return now_sh.date()
    return now_sh.date() - timedelta(days=1)


def last_closed_minute_sh(now_sh: datetime) -> datetime:
    """Drop seconds/micros, then step back one full minute."""
    return now_sh.replace(second=0, microsecond=0) - timedelta(minutes=1)


def market_cutoff_sh(now_sh: datetime) -> datetime:
    """
    Latest minute we consider valid for writes.
    If we're in a session: last closed minute.
    If we're between sessions: the last session end (02:30 or 15:30).
    """
    td0 = trading_day_start_date_sh(now_sh)

    night_start = SH_TZ.localize(datetime.combine(td0, dtime(20, 0)))
    next_day = td0 + timedelta(days=1)
    night_end = SH_TZ.localize(datetime.combine(next_day, dtime(2, 30)))
    day_start = SH_TZ.localize(datetime.combine(next_day, dtime(9, 0)))
    day_end = SH_TZ.localize(datetime.combine(next_day, dtime(15, 30)))

    if night_start <= now_sh <= night_end:
        return last_closed_minute_sh(now_sh)

    if night_end < now_sh < day_start:
        return night_end

    if day_start <= now_sh <= day_end:
        return last_closed_minute_sh(now_sh)

    # day_end < now_sh < next night_start
    return day_end


def parse_delaystr_sh(delaystr: str | None) -> datetime | None:
    """Parse SGE delay string to Shanghai timezone datetime."""
    if not delaystr:
        return None
    m = _DELAY_RE.match(delaystr)
    if not m:
        return None
    y, mo, d, hh, mm, ss = map(int, m.groups())
    naive = datetime(y, mo, d, hh, mm, ss)
    return SH_TZ.localize(naive)


def parse_point_timestamp_iso(time_hhmm: str, cutoff_sh: datetime) -> str | None:
    """Convert HH:MM to ISO8601 (+08:00) using SGE trading-day anchoring."""
    try:
        hh, mm = map(int, time_hhmm.split(":"))
    except Exception:
        return None

    td0 = trading_day_start_date_sh(cutoff_sh)
    point_date = td0 if hh >= 20 else (td0 + timedelta(days=1))

    naive = datetime.combine(point_date, dtime(hh, mm))
    point_sh = SH_TZ.localize(naive)

    # Points are minute-resolution; compare against minute-floored cutoff.
    cutoff_floor = cutoff_sh.replace(second=0, microsecond=0)
    if point_sh > cutoff_floor:
        return None

    return point_sh.isoformat()


def fetch_sge(inst: Instrument) -> tuple[list[str], list[float], dict]:
    """Fetch price data from SGE API for given instrument."""
    resp = requests.post(
        SGE_URL,
        headers=http_headers(),
        data="instid=" + inst.instid,
        timeout=10,
    )
    resp.raise_for_status()
    payload = resp.json()

    times = payload.get("times") or []
    data = payload.get("data") or []

    prices = []
    for p in data:
        try:
            prices.append(float(p))
        except Exception:
            prices.append(float("nan"))

    meta = {
        "min": payload.get("min"),
        "max": payload.get("max"),
        "heyue": payload.get("heyue"),
        "delaystr": payload.get("delaystr"),
    }
    return times, prices, meta


def can_make_fx_request(conn: sqlite3.Connection) -> bool:
    """Check if we can make another Alpha Vantage API request today."""
    try:
        today = datetime.now(timezone.utc).date().isoformat()
        row = conn.execute(
            "SELECT alpha_vantage_count FROM api_requests WHERE date = ?",
            (today,),
        ).fetchone()
        count = row[0] if row else 0
        return count < 24
    except Exception:
        return True


def inc_fx_request(conn: sqlite3.Connection) -> None:
    """Increment the Alpha Vantage API request count for today."""
    today = datetime.now(timezone.utc).date().isoformat()
    conn.execute(
        "INSERT OR IGNORE INTO api_requests(date, alpha_vantage_count) VALUES(?, 0)",
        (today,),
    )
    conn.execute(
        "UPDATE api_requests SET alpha_vantage_count = alpha_vantage_count + 1 "
        "WHERE date = ?",
        (today,),
    )
    conn.commit()


def get_cached_fx(conn: sqlite3.Connection) -> float:
    """Get the most recent USD/CNY exchange rate from database."""
    row = conn.execute(
        "SELECT usd_cny_rate FROM prices WHERE usd_cny_rate IS NOT NULL "
        "ORDER BY timestamp DESC LIMIT 1"
    ).fetchone()
    return float(row[0]) if row else FX_DEFAULT


def fetch_fx(conn: sqlite3.Connection, current_fx: float) -> float:
    """Fetch USD/CNY exchange rate from Alpha Vantage API with fallback to cached rate."""
    api_key = os.environ.get("ALPHA_VANTAGE_API_KEY")
    if not api_key:
        return get_cached_fx(conn)

    if not can_make_fx_request(conn):
        return get_cached_fx(conn)

    url = (
        "https://www.alphavantage.co/query"
        "?function=CURRENCY_EXCHANGE_RATE&from_currency=USD&to_currency=CNY"
        f"&apikey={api_key}"
    )

    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        j = r.json()
        rate_s = j.get("Realtime Currency Exchange Rate", {}).get("5. Exchange Rate")
        if not rate_s:
            return get_cached_fx(conn)

        new_fx = float(rate_s)
        if new_fx <= 0:
            return get_cached_fx(conn)

        # sanity clamp: <= 100% move
        if abs(new_fx - current_fx) / max(current_fx, 1e-9) > 1.0:
            return get_cached_fx(conn)

        inc_fx_request(conn)
        return new_fx
    except Exception:
        return get_cached_fx(conn)


def init_db(path: str) -> sqlite3.Connection:
    """Initialize SQLite database with required tables."""
    conn = sqlite3.connect(path)
    conn.execute(
        """
      CREATE TABLE IF NOT EXISTS prices (
        metal TEXT NOT NULL,
        timestamp TEXT NOT NULL,            -- ISO8601 with +08:00
        price_cny REAL NOT NULL,
        usd_cny_rate REAL,
        PRIMARY KEY (metal, timestamp)
      )
    """
    )
    conn.execute(
        """
      CREATE TABLE IF NOT EXISTS api_requests (
        date TEXT PRIMARY KEY,
        alpha_vantage_count INTEGER DEFAULT 0
      )
    """
    )
    conn.commit()
    return conn


def store_points(
    conn: sqlite3.Connection,
    metal: str,
    cutoff_sh: datetime,
    fx: float,
    times: list[str],
    prices: list[float],
) -> int:
    """Store price points in database, returning count of inserted records."""
    n = 0
    cur = conn.cursor()

    try:
        for t_hhmm, price in zip(times, prices):
            if price != price:  # NaN
                continue

            ts = parse_point_timestamp_iso(t_hhmm, cutoff_sh)
            if not ts:
                continue

            cur.execute(
                "INSERT OR REPLACE INTO prices("
                "metal, timestamp, price_cny, usd_cny_rate) "
                "VALUES(?, ?, ?, ?)",
                (metal, ts, float(price), float(fx)),
            )
            n += 1

        return n

    finally:
        cur.close()


def main():
    """Main collector loop - fetches SGE prices and stores in database."""
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s"
    )

    db_path = os.environ.get("SHANGHAI_DB", "shanghai_metals.db")
    conn = init_db(db_path)

    fx = get_cached_fx(conn)
    last_fx = 0.0

    backoff = 1.0

    while True:
        now = time.time()
        now_sh = datetime.now(SH_TZ)

        # refresh FX
        if now - last_fx >= FX_REFRESH_SEC:
            fx = fetch_fx(conn, fx)
            last_fx = now
            LOG.info("FX USD/CNY = %.6f", fx)

        try:
            conn.execute("BEGIN")
            total = 0

            for inst in INSTRUMENTS:
                times, prices, meta = fetch_sge(inst)

                now_sh = datetime.now(SH_TZ)
                api_sh = parse_delaystr_sh(meta.get("delaystr"))

                cutoff_sh = market_cutoff_sh(now_sh)
                if api_sh:
                    cutoff_sh = min(cutoff_sh, api_sh)

                wrote = store_points(conn, inst.metal, cutoff_sh, fx, times, prices)
                total += wrote

                LOG.info(
                    "%s %s: wrote=%d meta=%s",
                    inst.metal,
                    inst.unit,
                    wrote,
                    json.dumps(meta, ensure_ascii=False),
                )

            conn.commit()
            backoff = 1.0

        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass

            LOG.error("fetch/store failed: %s", e)
            time.sleep(backoff)
            backoff = min(backoff * 2, 300.0)

        # sleep to next minute-ish
        time.sleep(FETCH_INTERVAL_SEC)


if __name__ == "__main__":
    main()
