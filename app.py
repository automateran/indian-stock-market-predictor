from __future__ import annotations

import logging
import math
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any

from flask import Flask, jsonify, render_template, request

try:
    import pandas as pd
    import yfinance as yf
except ImportError:  # pragma: no cover - dependency installation is handled by Replit
    pd = None
    yf = None


BASE_PATH = ""
CACHE_TTL_SECONDS = 60
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("india-trading-analyst")

STOCKS: dict[str, dict[str, str]] = {
    "RELIANCE.NS": {"name": "Reliance Industries", "short_name": "RELIANCE", "sector": "Energy"},
    "HDFCBANK.NS": {"name": "HDFC Bank", "short_name": "HDFCBANK", "sector": "Financials"},
    "TCS.NS": {"name": "Tata Consultancy Services", "short_name": "TCS", "sector": "IT"},
    "INFY.NS": {"name": "Infosys", "short_name": "INFY", "sector": "IT"},
    "ICICIBANK.NS": {"name": "ICICI Bank", "short_name": "ICICIBANK", "sector": "Financials"},
    "SBIN.NS": {"name": "State Bank of India", "short_name": "SBIN", "sector": "Financials"},
    "ITC.NS": {"name": "ITC", "short_name": "ITC", "sector": "Consumer"},
    "LT.NS": {"name": "Larsen & Toubro", "short_name": "LT", "sector": "Industrials"},
    "BHARTIARTL.NS": {"name": "Bharti Airtel", "short_name": "BHARTIARTL", "sector": "Telecom"},
    "KOTAKBANK.NS": {"name": "Kotak Mahindra Bank", "short_name": "KOTAKBANK", "sector": "Financials"},
    "AXISBANK.NS": {"name": "Axis Bank", "short_name": "AXISBANK", "sector": "Financials"},
    "MARUTI.NS": {"name": "Maruti Suzuki India", "short_name": "MARUTI", "sector": "Auto"},
}

NIFTY_SYMBOL = "^NSEI"
cache_lock = threading.Lock()
market_cache: dict[str, Any] = {"expires_at": 0.0, "payload": None}

app = Flask(__name__, template_folder="templates", static_folder="static", static_url_path=f"{BASE_PATH}/static")


def _as_float(value: Any, digits: int = 2) -> float | None:
    try:
        numeric = float(value)
        if not math.isfinite(numeric):
            return None
        return round(numeric, digits)
    except (TypeError, ValueError):
        return None


def _fallback_series(symbol: str) -> list[dict[str, Any]]:
    seed = sum(ord(char) for char in symbol)
    base = 900 + (seed % 1800)
    direction = 1 if seed % 3 else -1
    series: list[dict[str, Any]] = []
    for index in range(20):
        wave = math.sin(index / 2.2 + seed) * 0.7
        drift = direction * index * 0.22
        close = base + drift + wave
        volume = 2_000_000 + ((seed * (index + 3) * 137) % 1_100_000)
        series.append(
            {
                "date": f"2026-08-{index + 1:02d}",
                "open": round(close - 3.2, 2),
                "high": round(close + 8.4, 2),
                "low": round(close - 9.1, 2),
                "close": round(close, 2),
                "volume": int(volume),
            }
        )
    return series


def _download_history(symbol: str) -> tuple[list[dict[str, Any]], str | None]:
    if yf is None or pd is None:
        return _fallback_series(symbol), "Python market-data packages are unavailable."
    try:
        frame = yf.download(
            symbol,
            period="2mo",
            interval="1d",
            auto_adjust=False,
            progress=False,
            threads=False,
            timeout=12,
        )
        if frame is None or frame.empty:
            return _fallback_series(symbol), "Yahoo Finance returned no rows."
        if isinstance(frame.columns, pd.MultiIndex):
            frame.columns = frame.columns.get_level_values(0)
        frame = frame.dropna(subset=["Close"]).tail(20)
        history: list[dict[str, Any]] = []
        for index, row in frame.iterrows():
            date_value = index.strftime("%Y-%m-%d") if hasattr(index, "strftime") else str(index)[:10]
            history.append(
                {
                    "date": date_value,
                    "open": _as_float(row.get("Open")),
                    "high": _as_float(row.get("High")),
                    "low": _as_float(row.get("Low")),
                    "close": _as_float(row.get("Close")),
                    "volume": int(row.get("Volume", 0) or 0),
                }
            )
        if len(history) < 5:
            return _fallback_series(symbol), "Yahoo Finance returned too little history."
        return history, None
    except Exception as error:  # network/provider failures should not blank the terminal
        logger.warning("market fetch failed for %s: %s", symbol, error)
        return _fallback_series(symbol), f"Live fetch unavailable for {symbol}."


def _consensus(history: list[dict[str, Any]]) -> dict[str, Any]:
    closes = [point["close"] for point in history if point.get("close") is not None]
    volumes = [point.get("volume", 0) or 0 for point in history]
    if len(closes) < 5:
        return {
            "status": "Hold",
            "tone": "neutral",
            "score": 50,
            "trend_percent": 0,
            "volume_ratio": 1,
            "reason": "Waiting for enough market history to form a consensus.",
        }

    first_window = closes[:5]
    last_window = closes[-5:]
    trend_percent = ((sum(last_window) / len(last_window)) / (sum(first_window) / len(first_window)) - 1) * 100
    early_volume = sum(volumes[:5]) / max(len(volumes[:5]), 1)
    recent_volume = sum(volumes[-5:]) / max(len(volumes[-5:]), 1)
    volume_ratio = recent_volume / early_volume if early_volume else 1
    rising = trend_percent > 0.25
    falling = trend_percent < -0.25
    increasing_volume = volume_ratio > 1.05

    if rising and increasing_volume:
        status, tone, score = "Strong Buy", "positive", min(96, round(72 + trend_percent * 2 + (volume_ratio - 1) * 25))
        reason = "20-day price trend is positive and recent volume is expanding."
    elif falling:
        status, tone, score = "Sell", "negative", max(18, round(42 + trend_percent * 2))
        reason = "20-day price trend is negative; downside momentum is dominant."
    elif rising:
        status, tone, score = "Buy", "positive", min(74, round(58 + trend_percent * 2))
        reason = "Price is trending higher, but volume confirmation is limited."
    else:
        status, tone, score = "Hold", "neutral", 50
        reason = "Price action is range-bound without a decisive volume signal."

    return {
        "status": status,
        "tone": tone,
        "score": score,
        "trend_percent": _as_float(trend_percent),
        "volume_ratio": _as_float(volume_ratio),
        "reason": reason,
    }


def _analyze_symbol(symbol: str) -> dict[str, Any]:
    normalized = symbol.upper().strip()
    metadata = STOCKS.get(normalized, {"name": normalized.replace(".NS", ""), "short_name": normalized.replace(".NS", ""), "sector": "NIFTY 50"})
    history, warning = _download_history(normalized)
    current = history[-1]["close"]
    previous = history[-2]["close"] if len(history) > 1 else current
    change = current - previous
    change_percent = (change / previous * 100) if previous else 0
    consensus = _consensus(history)
    return {
        "symbol": normalized,
        "name": metadata["name"],
        "short_name": metadata["short_name"],
        "sector": metadata["sector"],
        "price": current,
        "change": _as_float(change),
        "change_percent": _as_float(change_percent),
        "consensus": consensus,
        "history": history,
        "data_source": "demo" if warning else "yahoo_finance",
        "warning": warning,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _market_payload(symbols: list[str] | None = None) -> dict[str, Any]:
    requested = symbols or list(STOCKS.keys())
    valid_symbols = [symbol.upper().strip() for symbol in requested if symbol.upper().strip()]
    stocks = [_analyze_symbol(symbol) for symbol in valid_symbols[:20]]
    index_history, index_warning = _download_history(NIFTY_SYMBOL)
    index_price = index_history[-1]["close"]
    index_previous = index_history[-2]["close"] if len(index_history) > 1 else index_price
    index_change = index_price - index_previous
    index_change_percent = (index_change / index_previous * 100) if index_previous else 0
    warnings = [stock["warning"] for stock in stocks if stock.get("warning")]
    if index_warning:
        warnings.append(index_warning)
    return {
        "index": {
            "symbol": NIFTY_SYMBOL,
            "name": "NIFTY 50",
            "price": index_price,
            "change": _as_float(index_change),
            "change_percent": _as_float(index_change_percent),
            "data_source": "demo" if index_warning else "yahoo_finance",
        },
        "stocks": stocks,
        "data_source": "demo" if warnings else "yahoo_finance",
        "warning": "Live data is temporarily unavailable. Showing clearly marked demo values." if warnings else None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def get_market_payload(symbols: list[str] | None = None, force_refresh: bool = False) -> dict[str, Any]:
    cache_key = ",".join(symbols or list(STOCKS.keys()))
    with cache_lock:
        is_valid = (
            not force_refresh
            and market_cache["payload"] is not None
            and market_cache.get("key") == cache_key
            and market_cache["expires_at"] > time.time()
        )
        if is_valid:
            return market_cache["payload"]
    payload = _market_payload(symbols)
    with cache_lock:
        market_cache.update({"key": cache_key, "payload": payload, "expires_at": time.time() + CACHE_TTL_SECONDS})
    return payload


@app.get("/")
@app.get("/dashboard")
@app.get("/stocks")
def dashboard():
    active_page = request.path.rsplit("/", 1)[-1] or "dashboard"
    return render_template("index.html", active_page=active_page, base_path=BASE_PATH)


@app.get("/learn")
def learn():
    return render_template("index.html", active_page="learn", base_path=BASE_PATH)


@app.get("/api/healthz")
def healthz():
    return jsonify({"status": "ok", "service": "india-trading-analyst", "time": datetime.now(timezone.utc).isoformat()})


@app.get("/api/market")
def market():
    raw_symbols = request.args.get("symbols", "")
    symbols = [item for item in raw_symbols.split(",") if item] if raw_symbols else None
    return jsonify(get_market_payload(symbols, force_refresh=request.args.get("refresh") == "1"))


@app.get("/api/market/<path:symbol>")
def market_symbol(symbol: str):
    normalized = symbol.upper()
    if not normalized.endswith(".NS"):
        normalized = f"{normalized}.NS"
    return jsonify(_analyze_symbol(normalized))


@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Route not found"}), 404
    return render_template("index.html", active_page="dashboard", base_path=BASE_PATH)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)