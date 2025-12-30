import pytest
from datetime import datetime, time as dtime, timedelta
import pytz
from collector import (
    trading_day_start_date_sh,
    last_closed_minute_sh,
    market_cutoff_sh,
    parse_delaystr_sh,
    parse_point_timestamp_iso,
    can_make_fx_request,
    inc_fx_request,
    get_cached_fx,
    fetch_sge,
    Instrument,
    SH_TZ,
    FX_DEFAULT,
)
import sqlite3
import tempfile
import os
from unittest.mock import patch, MagicMock


class TestTradingDayLogic:
    """Test trading day boundary calculations."""

    def test_trading_day_start_date_sh_before_20(self):
        """Test trading day start when time is before 20:00."""
        # 15:30 Shanghai time should return previous day
        dt = SH_TZ.localize(datetime(2025, 1, 15, 15, 30))
        result = trading_day_start_date_sh(dt)
        expected = datetime(2025, 1, 14).date()
        assert result == expected

    def test_trading_day_start_date_sh_after_20(self):
        """Test trading day start when time is after 20:00."""
        # 21:00 Shanghai time should return same day
        dt = SH_TZ.localize(datetime(2025, 1, 15, 21, 0))
        result = trading_day_start_date_sh(dt)
        expected = datetime(2025, 1, 15).date()
        assert result == expected

    def test_trading_day_start_date_sh_exactly_20(self):
        """Test trading day start when time is exactly 20:00."""
        dt = SH_TZ.localize(datetime(2025, 1, 15, 20, 0))
        result = trading_day_start_date_sh(dt)
        expected = datetime(2025, 1, 15).date()
        assert result == expected

    def test_last_closed_minute_sh(self):
        """Test last closed minute calculation."""
        dt = SH_TZ.localize(datetime(2025, 1, 15, 14, 35, 42, 123456))
        result = last_closed_minute_sh(dt)
        expected = SH_TZ.localize(datetime(2025, 1, 15, 14, 34, 0))
        assert result == expected

    def test_market_cutoff_sh_in_day_session(self):
        """Test market cutoff during day session."""
        # 14:30 is in day session (9:00-15:30)
        dt = SH_TZ.localize(datetime(2025, 1, 15, 14, 30, 30))
        result = market_cutoff_sh(dt)
        expected = SH_TZ.localize(datetime(2025, 1, 15, 14, 29, 0))
        assert result == expected

    def test_market_cutoff_sh_in_night_session(self):
        """Test market cutoff during night session."""
        # 21:30 is in night session (20:00-02:30)
        dt = SH_TZ.localize(datetime(2025, 1, 15, 21, 30, 30))
        result = market_cutoff_sh(dt)
        expected = SH_TZ.localize(datetime(2025, 1, 15, 21, 29, 0))
        assert result == expected

    def test_market_cutoff_sh_between_sessions_morning(self):
        """Test market cutoff between night and day sessions."""
        # 08:00 is between sessions, should return night end (02:30)
        dt = SH_TZ.localize(datetime(2025, 1, 15, 8, 0))
        result = market_cutoff_sh(dt)
        expected = SH_TZ.localize(datetime(2025, 1, 15, 2, 30))
        assert result == expected

    def test_market_cutoff_sh_between_sessions_evening(self):
        """Test market cutoff between day and night sessions."""
        # 18:00 is between sessions, should return day end (15:30)
        dt = SH_TZ.localize(datetime(2025, 1, 15, 18, 0))
        result = market_cutoff_sh(dt)
        expected = SH_TZ.localize(datetime(2025, 1, 15, 15, 30))
        assert result == expected


class TestDelayStringParsing:
    """Test SGE delay string parsing."""

    def test_parse_delaystr_sh_valid(self):
        """Test parsing valid delay string."""
        delaystr = "2025年01月15日 14:30:25"
        result = parse_delaystr_sh(delaystr)
        expected = SH_TZ.localize(datetime(2025, 1, 15, 14, 30, 25))
        assert result == expected

    def test_parse_delaystr_sh_none(self):
        """Test parsing None delay string."""
        result = parse_delaystr_sh(None)
        assert result is None

    def test_parse_delaystr_sh_empty(self):
        """Test parsing empty delay string."""
        result = parse_delaystr_sh("")
        assert result is None

    def test_parse_delaystr_sh_invalid_format(self):
        """Test parsing invalid delay string format."""
        result = parse_delaystr_sh("invalid format")
        assert result is None


class TestTimestampParsing:
    """Test HH:MM timestamp parsing."""

    def test_parse_point_timestamp_iso_day_session(self):
        """Test parsing timestamp in day session."""
        cutoff = SH_TZ.localize(datetime(2025, 1, 15, 14, 30))
        result = parse_point_timestamp_iso("14:25", cutoff)
        expected = "2025-01-15T14:25:00+08:00"
        assert result == expected

    def test_parse_point_timestamp_iso_night_session(self):
        """Test parsing timestamp in night session."""
        cutoff = SH_TZ.localize(datetime(2025, 1, 15, 21, 30))
        result = parse_point_timestamp_iso("21:25", cutoff)
        expected = "2025-01-15T21:25:00+08:00"
        assert result == expected

    def test_parse_point_timestamp_iso_night_early_morning(self):
        """Test parsing early morning timestamp in night session."""
        cutoff = SH_TZ.localize(datetime(2025, 1, 16, 1, 30))
        result = parse_point_timestamp_iso("01:25", cutoff)
        expected = "2025-01-16T01:25:00+08:00"
        assert result == expected

    def test_parse_point_timestamp_iso_after_cutoff(self):
        """Test parsing timestamp after cutoff returns None."""
        cutoff = SH_TZ.localize(datetime(2025, 1, 15, 14, 30))
        result = parse_point_timestamp_iso("14:35", cutoff)
        assert result is None

    def test_parse_point_timestamp_iso_invalid_format(self):
        """Test parsing invalid timestamp format."""
        cutoff = SH_TZ.localize(datetime(2025, 1, 15, 14, 30))
        result = parse_point_timestamp_iso("invalid", cutoff)
        assert result is None


class TestFXRateLimiting:
    """Test FX API rate limiting logic."""

    def setup_method(self):
        """Set up test database."""
        self.db_fd, self.db_path = tempfile.mkstemp()
        self.conn = sqlite3.connect(self.db_path)
        self.conn.execute(
            """
            CREATE TABLE api_requests (
                date TEXT PRIMARY KEY,
                alpha_vantage_count INTEGER DEFAULT 0
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE prices (
                metal TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                price_cny REAL NOT NULL,
                usd_cny_rate REAL,
                PRIMARY KEY (metal, timestamp)
            )
            """
        )
        self.conn.commit()

    def teardown_method(self):
        """Clean up test database."""
        self.conn.close()
        os.close(self.db_fd)
        os.unlink(self.db_path)

    def test_can_make_fx_request_no_records(self):
        """Test FX request check with no existing records."""
        result = can_make_fx_request(self.conn)
        assert result is True

    def test_can_make_fx_request_under_limit(self):
        """Test FX request check under daily limit."""
        today = datetime.now().date().isoformat()
        self.conn.execute(
            "INSERT INTO api_requests(date, alpha_vantage_count) VALUES(?, ?)",
            (today, 10),
        )
        self.conn.commit()
        result = can_make_fx_request(self.conn)
        assert result is True

    def test_can_make_fx_request_at_limit(self):
        """Test FX request check at daily limit."""
        today = datetime.now().date().isoformat()
        self.conn.execute(
            "INSERT INTO api_requests(date, alpha_vantage_count) VALUES(?, ?)",
            (today, 24),
        )
        self.conn.commit()
        result = can_make_fx_request(self.conn)
        assert result is False

    def test_inc_fx_request_new_date(self):
        """Test incrementing FX request count for new date."""
        inc_fx_request(self.conn)
        today = datetime.now().date().isoformat()
        row = self.conn.execute(
            "SELECT alpha_vantage_count FROM api_requests WHERE date = ?", (today,)
        ).fetchone()
        assert row[0] == 1

    def test_inc_fx_request_existing_date(self):
        """Test incrementing FX request count for existing date."""
        today = datetime.now().date().isoformat()
        self.conn.execute(
            "INSERT INTO api_requests(date, alpha_vantage_count) VALUES(?, ?)",
            (today, 5),
        )
        self.conn.commit()
        inc_fx_request(self.conn)
        row = self.conn.execute(
            "SELECT alpha_vantage_count FROM api_requests WHERE date = ?", (today,)
        ).fetchone()
        assert row[0] == 6

    def test_get_cached_fx_no_data(self):
        """Test getting cached FX rate with no data."""
        result = get_cached_fx(self.conn)
        assert result == FX_DEFAULT

    def test_get_cached_fx_with_data(self):
        """Test getting cached FX rate with existing data."""
        self.conn.execute(
            "INSERT INTO prices(metal, timestamp, price_cny, usd_cny_rate) "
            "VALUES(?, ?, ?, ?)",
            ("gold", "2025-01-15T14:30:00+08:00", 500.0, 7.2345),
        )
        self.conn.commit()
        result = get_cached_fx(self.conn)
        assert result == 7.2345


class TestSGEFetching:
    """Test SGE API data fetching."""

    @patch("collector.requests.post")
    def test_fetch_sge_success(self, mock_post):
        """Test successful SGE data fetch."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "times": ["14:30", "14:31"],
            "data": ["500.50", "500.75"],
            "min": 500.0,
            "max": 501.0,
            "heyue": "Au(T+D)",
            "delaystr": "2025年01月15日 14:32:00",
        }
        mock_post.return_value = mock_response

        inst = Instrument(metal="gold", instid="Au(T%2BD)", unit="CNY/g")
        times, prices, meta = fetch_sge(inst)

        assert times == ["14:30", "14:31"]
        assert prices == [500.50, 500.75]
        assert meta["min"] == 500.0
        assert meta["max"] == 501.0
        assert meta["heyue"] == "Au(T+D)"

    @patch("collector.requests.post")
    def test_fetch_sge_invalid_price(self, mock_post):
        """Test SGE fetch with invalid price data."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "times": ["14:30", "14:31"],
            "data": ["500.50", "invalid"],
            "min": 500.0,
            "max": 501.0,
        }
        mock_post.return_value = mock_response

        inst = Instrument(metal="gold", instid="Au(T%2BD)", unit="CNY/g")
        times, prices, meta = fetch_sge(inst)

        assert times == ["14:30", "14:31"]
        assert prices[0] == 500.50
        assert prices[1] != prices[1]  # NaN check


class TestFetchFX:
    """Test FX rate fetching logic."""

    def setup_method(self):
        """Set up test database."""
        self.db_fd, self.db_path = tempfile.mkstemp()
        self.conn = sqlite3.connect(self.db_path)
        self.conn.execute(
            """
            CREATE TABLE api_requests (
                date TEXT PRIMARY KEY,
                alpha_vantage_count INTEGER DEFAULT 0
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE prices (
                metal TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                price_cny REAL NOT NULL,
                usd_cny_rate REAL,
                PRIMARY KEY (metal, timestamp)
            )
            """
        )
        self.conn.commit()

    def teardown_method(self):
        """Clean up test database."""
        self.conn.close()
        os.close(self.db_fd)
        os.unlink(self.db_path)

    @patch.dict(os.environ, {}, clear=True)
    def test_fetch_fx_no_api_key(self):
        """Test FX fetch with no API key."""
        from collector import fetch_fx

        result = fetch_fx(self.conn, 7.0)
        assert result == FX_DEFAULT

    @patch.dict(os.environ, {"ALPHA_VANTAGE_API_KEY": "test_key"})
    @patch("collector.requests.get")
    def test_fetch_fx_success(self, mock_get):
        """Test successful FX fetch."""
        from collector import fetch_fx

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "Realtime Currency Exchange Rate": {"5. Exchange Rate": "7.2345"}
        }
        mock_get.return_value = mock_response

        result = fetch_fx(self.conn, 7.0)
        assert result == 7.2345

    @patch.dict(os.environ, {"ALPHA_VANTAGE_API_KEY": "test_key"})
    @patch("collector.requests.get")
    def test_fetch_fx_invalid_response(self, mock_get):
        """Test FX fetch with invalid API response."""
        from collector import fetch_fx

        mock_response = MagicMock()
        mock_response.json.return_value = {}
        mock_get.return_value = mock_response

        result = fetch_fx(self.conn, 7.0)
        assert result == FX_DEFAULT

    @patch.dict(os.environ, {"ALPHA_VANTAGE_API_KEY": "test_key"})
    @patch("collector.requests.get")
    def test_fetch_fx_rate_limit_exceeded(self, mock_get):
        """Test FX fetch when rate limit is exceeded."""
        from collector import fetch_fx

        # Set up rate limit exceeded
        today = datetime.now().date().isoformat()
        self.conn.execute(
            "INSERT INTO api_requests(date, alpha_vantage_count) VALUES(?, ?)",
            (today, 24),
        )
        self.conn.commit()

        result = fetch_fx(self.conn, 7.0)
        assert result == FX_DEFAULT
        # Should not call the API
        mock_get.assert_not_called()


class TestStorePoints:
    """Test price point storage logic."""

    def setup_method(self):
        """Set up test database."""
        self.db_fd, self.db_path = tempfile.mkstemp()
        self.conn = sqlite3.connect(self.db_path)
        self.conn.execute(
            """
            CREATE TABLE prices (
                metal TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                price_cny REAL NOT NULL,
                usd_cny_rate REAL,
                PRIMARY KEY (metal, timestamp)
            )
            """
        )
        self.conn.commit()

    def teardown_method(self):
        """Clean up test database."""
        self.conn.close()
        os.close(self.db_fd)
        os.unlink(self.db_path)

    def test_store_points_success(self):
        """Test successful point storage."""
        from collector import store_points

        cutoff = SH_TZ.localize(datetime(2025, 1, 15, 14, 30))
        times = ["14:25", "14:26"]
        prices = [500.0, 501.0]

        result = store_points(self.conn, "gold", cutoff, 7.0, times, prices)
        assert result == 2

        # Verify data was stored
        rows = self.conn.execute("SELECT * FROM prices ORDER BY timestamp").fetchall()
        assert len(rows) == 2
        assert rows[0][2] == 500.0  # price_cny
        assert rows[1][2] == 501.0

    def test_store_points_with_nan(self):
        """Test point storage with NaN prices."""
        from collector import store_points

        cutoff = SH_TZ.localize(datetime(2025, 1, 15, 14, 30))
        times = ["14:25", "14:26"]
        prices = [500.0, float("nan")]

        result = store_points(self.conn, "gold", cutoff, 7.0, times, prices)
        assert result == 1  # Only one valid price stored
