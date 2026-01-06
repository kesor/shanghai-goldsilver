#!/usr/bin/env python3
import asyncio
import json
import sqlite3
import threading
from dataclasses import dataclass
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Any, Dict

import websockets
import websockets.server


@dataclass(frozen=True)
class WSConfig:
    host: str = "localhost"
    ws_port: int = 8001
    http_port: int = 8000
    db_path: str = "shanghai_metals.db"
    lookback_hours: int = 6
    poll_sec: float = 1.0


class DataServer:
    def __init__(self, cfg: WSConfig):
        self.cfg = cfg
        self.clients: set[Any] = set()
        self.last_payload: str | None = None

    async def register(self, ws):
        """Register new WebSocket client and send initial data."""
        self.clients.add(ws)
        await ws.send(self._fetch_payload(0))

    async def unregister(self, ws):
        """Remove WebSocket client from active clients set."""
        self.clients.discard(ws)

    def _fetch_payload_for_time_range(self, start_offset_hours: int, end_offset_hours: int, metal: str) -> str:
        """Return JSON string for specific metal and time range: { metal: [...] }"""
        out: Dict[str, list] = {metal: []}

        try:
            conn = sqlite3.connect(self.cfg.db_path)
            conn.row_factory = sqlite3.Row

            sql = """
        SELECT timestamp, price_cny, usd_cny_rate
        FROM prices
        WHERE metal = ?
          AND datetime(timestamp) >= datetime('now', ?)
          AND datetime(timestamp) <= datetime('now', ?)
        ORDER BY datetime(timestamp)
      """
            start_offset = f"-{int(start_offset_hours)} hours"
            end_offset = f"-{int(end_offset_hours)} hours"
            
            rows = conn.execute(sql, (metal, start_offset, end_offset)).fetchall()
            out[metal] = [
                {
                    "timestamp": r["timestamp"],
                    "price_cny": r["price_cny"],
                    "usd_cny_rate": r["usd_cny_rate"],
                }
                for r in rows
            ]

            conn.close()

        except Exception as e:
            print(f"DB read error: {e}")

        return json.dumps(out, separators=(",", ":"), ensure_ascii=False)

    def _fetch_payload_for_metal(self, offset_hours: int, metal: str) -> str:
        """Return JSON string for specific metal: { metal: [...] }"""
        out: Dict[str, list] = {metal: []}

        try:
            conn = sqlite3.connect(self.cfg.db_path)
            conn.row_factory = sqlite3.Row

            if offset_hours == 0:
                # Live data - need enough history for both night and day sessions
                sql = """
            SELECT timestamp, price_cny, usd_cny_rate
            FROM prices
            WHERE metal = ?
              AND datetime(timestamp) >= datetime('now', ?)
            ORDER BY datetime(timestamp)
          """
                lookback = "-36 hours"  # Ensure we get both sessions
                
                rows = conn.execute(sql, (metal, lookback)).fetchall()
                out[metal] = [
                    {
                        "timestamp": r["timestamp"],
                        "price_cny": r["price_cny"],
                        "usd_cny_rate": r["usd_cny_rate"],
                    }
                    for r in rows
                ]
            else:
                # Historical data - 36 hour window
                sql = """
            SELECT timestamp, price_cny, usd_cny_rate
            FROM prices
            WHERE metal = ?
              AND datetime(timestamp) >= datetime('now', ?)
              AND datetime(timestamp) < datetime('now', ?)
            ORDER BY datetime(timestamp)
          """
                start_offset = f"-{int(36 + offset_hours)} hours"
                end_offset = f"-{offset_hours} hours"
                
                rows = conn.execute(sql, (metal, start_offset, end_offset)).fetchall()
                out[metal] = [
                    {
                        "timestamp": r["timestamp"],
                        "price_cny": r["price_cny"],
                        "usd_cny_rate": r["usd_cny_rate"],
                    }
                    for r in rows
                ]
                
                out["_offset"] = offset_hours

            conn.close()

        except Exception as e:
            print(f"DB read error: {e}")

        return json.dumps(out, separators=(",", ":"), ensure_ascii=False)

    def _fetch_payload(self, offset_hours: int = 0) -> str:
        """Return JSON string: { gold: [...], silver: [...] }"""
        out: Dict[str, list] = {"gold": [], "silver": []}

        try:
            conn = sqlite3.connect(self.cfg.db_path)
            conn.row_factory = sqlite3.Row

            if offset_hours == 0:
                # Live data - need enough history for both night and day sessions
                sql = """
            SELECT timestamp, price_cny, usd_cny_rate
            FROM prices
            WHERE metal = ?
              AND datetime(timestamp) >= datetime('now', ?)
            ORDER BY datetime(timestamp)
          """
                lookback = "-36 hours"  # Ensure we get both sessions
                
                for metal in ("gold", "silver"):
                    rows = conn.execute(sql, (metal, lookback)).fetchall()
                    out[metal] = [
                        {
                            "timestamp": r["timestamp"],
                            "price_cny": r["price_cny"],
                            "usd_cny_rate": r["usd_cny_rate"],
                        }
                        for r in rows
                    ]
            else:
                # Historical data - 36 hour window
                sql = """
            SELECT timestamp, price_cny, usd_cny_rate
            FROM prices
            WHERE metal = ?
              AND datetime(timestamp) >= datetime('now', ?)
              AND datetime(timestamp) < datetime('now', ?)
            ORDER BY datetime(timestamp)
          """
                start_offset = f"-{int(36 + offset_hours)} hours"
                end_offset = f"-{offset_hours} hours"
                
                for metal in ("gold", "silver"):
                    rows = conn.execute(sql, (metal, start_offset, end_offset)).fetchall()
                    out[metal] = [
                        {
                            "timestamp": r["timestamp"],
                            "price_cny": r["price_cny"],
                            "usd_cny_rate": r["usd_cny_rate"],
                        }
                        for r in rows
                    ]
                
                out["_offset"] = offset_hours

            conn.close()

        except Exception as e:
            print(f"DB read error: {e}")

        return json.dumps(out, separators=(",", ":"), ensure_ascii=False)

    async def broadcast_updates(self):
        """Continuously fetch data and broadcast updates to clients."""
        while True:
            payload = self._fetch_payload(0)

            if payload != self.last_payload:
                self.last_payload = payload

                if self.clients:
                    dead = []
                    for ws in self.clients:
                        try:
                            await ws.send(payload)
                        except Exception:
                            dead.append(ws)
                    for ws in dead:
                        self.clients.discard(ws)

            await asyncio.sleep(self.cfg.poll_sec)

    async def handle_client(self, ws):
        """Handle WebSocket client connection lifecycle."""
        await self.register(ws)
        try:
            async for message in ws:
                try:
                    req = json.loads(message)
                    if req.get("type") == "fetch":
                        metal = req.get("metal")
                        if "start_offset_hours" in req and "end_offset_hours" in req:
                            # New precise time range request
                            payload = self._fetch_payload_for_time_range(
                                req["start_offset_hours"], 
                                req["end_offset_hours"], 
                                metal
                            )
                        elif "offset_hours" in req:
                            # Legacy offset request
                            if metal:
                                payload = self._fetch_payload_for_metal(req["offset_hours"], metal)
                            else:
                                payload = self._fetch_payload(req["offset_hours"])
                        else:
                            continue
                        await ws.send(payload)
                except Exception as e:
                    print(f"Message error: {e}")
        except Exception:
            pass
        finally:
            await self.unregister(ws)


def start_http_server(port: int):
    """Start HTTP server for serving static files."""
    HTTPServer(("localhost", port), SimpleHTTPRequestHandler).serve_forever()


async def main():
    """Start WebSocket server and HTTP server for the metals data service."""
    cfg = WSConfig()
    srv = DataServer(cfg)

    threading.Thread(
        target=start_http_server, args=(cfg.http_port,), daemon=True
    ).start()

    async with websockets.serve(srv.handle_client, cfg.host, cfg.ws_port):
        await srv.broadcast_updates()


if __name__ == "__main__":
    asyncio.run(main())
