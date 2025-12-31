import asyncio
import json
import os
import sqlite3
import tempfile
from unittest.mock import MagicMock

import pytest

from websocket_metals import DataServer, WSConfig


class TestDataServer:
    """Test WebSocket data server functionality."""

    def setup_method(self):
        """Set up test database and server."""
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
        self.conn.close()

        self.cfg = WSConfig(db_path=self.db_path, lookback_hours=1)
        self.server = DataServer(self.cfg)

    def teardown_method(self):
        """Clean up test database."""
        os.close(self.db_fd)
        os.unlink(self.db_path)

    def test_fetch_payload_empty_db(self):
        """Test fetching payload from empty database."""
        payload = self.server._fetch_payload()
        data = json.loads(payload)

        assert "gold" in data
        assert "silver" in data
        assert data["gold"] == []
        assert data["silver"] == []

    def test_fetch_payload_with_data(self):
        """Test fetching payload with sample data."""
        from datetime import datetime, timezone

        # Use current time to ensure data is within lookback window
        now = datetime.now(timezone.utc)
        timestamp = now.strftime("%Y-%m-%dT%H:%M:%S+00:00")

        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "INSERT INTO prices(metal, timestamp, price_cny, usd_cny_rate) "
            "VALUES(?, ?, ?, ?)",
            ("gold", timestamp, 612.50, 7.2456),
        )
        conn.execute(
            "INSERT INTO prices(metal, timestamp, price_cny, usd_cny_rate) "
            "VALUES(?, ?, ?, ?)",
            ("silver", timestamp, 8500.0, 7.2456),
        )
        conn.commit()
        conn.close()

        payload = self.server._fetch_payload()
        data = json.loads(payload)

        assert len(data["gold"]) == 1
        assert len(data["silver"]) == 1
        assert data["gold"][0]["price_cny"] == 612.50
        assert data["silver"][0]["price_cny"] == 8500.0

    @pytest.mark.asyncio
    async def test_register_unregister(self):
        """Test client registration and unregistration."""
        mock_ws = MagicMock()
        mock_ws.send = MagicMock(return_value=asyncio.Future())
        mock_ws.send.return_value.set_result(None)

        await self.server.register(mock_ws)
        assert mock_ws in self.server.clients
        mock_ws.send.assert_called_once()

        await self.server.unregister(mock_ws)
        assert mock_ws not in self.server.clients


class TestWSConfig:
    """Test WebSocket configuration."""

    def test_default_config(self):
        """Test default configuration values."""
        cfg = WSConfig()
        assert cfg.host == "localhost"
        assert cfg.ws_port == 8001
        assert cfg.http_port == 8000
        assert cfg.db_path == "shanghai_metals.db"
        assert cfg.lookback_hours == 36
        assert cfg.poll_sec == 1.0

    def test_custom_config(self):
        """Test custom configuration values."""
        cfg = WSConfig(
            host="0.0.0.0",
            ws_port=9001,
            http_port=9000,
            db_path="test.db",
            lookback_hours=24,
            poll_sec=0.5,
        )
        assert cfg.host == "0.0.0.0"
        assert cfg.ws_port == 9001
        assert cfg.http_port == 9000
        assert cfg.db_path == "test.db"
        assert cfg.lookback_hours == 24
        assert cfg.poll_sec == 0.5
