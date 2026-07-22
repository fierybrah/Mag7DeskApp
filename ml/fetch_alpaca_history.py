from __future__ import annotations

import argparse
import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import certifi

from .fetch_history import load_symbols


ALPACA_BARS_URL = "https://data.alpaca.markets/v2/stocks/bars"
TO_ALPACA_SYMBOL = {"BRK-B": "BRK.B"}
FROM_ALPACA_SYMBOL = {value: key for key, value in TO_ALPACA_SYMBOL.items()}


def load_local_env() -> None:
    path = next((candidate for candidate in (Path("alpaca.env"), Path(".env")) if candidate.exists()), None)
    if path is None:
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if name in {"ALPACA_API_KEY", "ALPACA_API_SECRET", "APCA_API_KEY_ID", "APCA_API_SECRET_KEY"}:
            os.environ.setdefault(name, value)


def credentials() -> tuple[str, str]:
    load_local_env()
    key = os.environ.get("ALPACA_API_KEY") or os.environ.get("APCA_API_KEY_ID")
    secret = os.environ.get("ALPACA_API_SECRET") or os.environ.get("APCA_API_SECRET_KEY")
    if not key or not secret:
        raise RuntimeError(
            "Alpaca credentials are missing. Set ALPACA_API_KEY and ALPACA_API_SECRET "
            "in the shell before running this command."
        )
    return key, secret


def request_page(
    symbols: list[str], start: datetime, end: datetime, key: str, secret: str,
    page_token: str | None = None, feed: str = "sip",
) -> dict:
    query = {
        "symbols": ",".join(TO_ALPACA_SYMBOL.get(symbol, symbol) for symbol in symbols),
        "timeframe": "1Day",
        "start": start.isoformat().replace("+00:00", "Z"),
        "end": end.isoformat().replace("+00:00", "Z"),
        "adjustment": "all",
        "feed": feed,
        "sort": "asc",
        "limit": 10000,
    }
    if page_token:
        query["page_token"] = page_token
    request = urllib.request.Request(
        f"{ALPACA_BARS_URL}?{urllib.parse.urlencode(query)}",
        headers={
            "APCA-API-KEY-ID": key,
            "APCA-API-SECRET-KEY": secret,
            "Accept": "application/json",
            "User-Agent": "Mag7StockDesk/1.0",
        },
    )
    try:
        tls_context = ssl.create_default_context(cafile=certifi.where())
        with urllib.request.urlopen(request, timeout=60, context=tls_context) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Alpaca returned HTTP {error.code}: {detail}") from error


def bars_to_frame(payload: dict) -> pd.DataFrame:
    rows = []
    for symbol, bars in (payload.get("bars") or {}).items():
        for bar in bars or []:
            rows.append({
                "date": str(bar.get("t", ""))[:10],
                "symbol": FROM_ALPACA_SYMBOL.get(symbol, symbol),
                "open": bar.get("o"),
                "high": bar.get("h"),
                "low": bar.get("l"),
                "close": bar.get("c"),
                "volume": bar.get("v"),
            })
    return pd.DataFrame(rows, columns=["date", "symbol", "open", "high", "low", "close", "volume"])


def download(symbols: list[str], years: int, feed: str) -> pd.DataFrame:
    key, secret = credentials()
    # Basic Alpaca accounts may query SIP history except for the latest
    # 15-minute window. A 30-minute buffer avoids subscription errors while
    # retaining every completed daily session.
    end = datetime.now(timezone.utc) - timedelta(minutes=30)
    start = end - timedelta(days=round(years * 365.25))
    frames = []
    token = None
    pages = 0
    while True:
        payload = request_page(symbols, start, end, key, secret, token, feed)
        frame = bars_to_frame(payload)
        if not frame.empty:
            frames.append(frame)
        pages += 1
        token = payload.get("next_page_token")
        print(f"page {pages}: {len(frame)} rows")
        if not token:
            break
        if pages >= 100:
            raise RuntimeError("Alpaca pagination exceeded 100 pages; refusing a potentially incomplete download")
    if not frames:
        raise RuntimeError("Alpaca returned no daily bars")
    return pd.concat(frames, ignore_index=True)


def validate_dataset(frame: pd.DataFrame, requested_symbols: list[str], minimum_years: int = 7) -> dict:
    data = frame.copy()
    data["date"] = pd.to_datetime(data["date"], errors="coerce")
    data = data.dropna(subset=["date", "symbol", "close"])
    duplicate_rows = int(data.duplicated(["date", "symbol"]).sum())
    available = set(data["symbol"].unique())
    missing = sorted(set(requested_symbols).difference(available))
    first_date = data["date"].min()
    last_date = data["date"].max()
    span_years = (last_date - first_date).days / 365.25
    benchmark_rows = int(data["symbol"].eq("SPY").sum())
    issues = []
    if duplicate_rows:
        issues.append(f"{duplicate_rows} duplicate symbol-date rows")
    if benchmark_rows < 252 * minimum_years:
        issues.append(f"SPY has only {benchmark_rows} daily rows")
    if span_years < minimum_years - 0.1:
        issues.append(f"history spans only {span_years:.1f} years")
    if len(available) < max(50, len(requested_symbols) * 0.8):
        issues.append(f"only {len(available)} of {len(requested_symbols)} symbols are available")
    return {
        "rows": int(len(data)), "symbols": len(available), "requested_symbols": len(requested_symbols),
        "missing_symbols": missing, "duplicate_rows": duplicate_rows,
        "first_date": first_date.date().isoformat(), "last_date": last_date.date().isoformat(),
        "span_years": round(span_years, 2), "benchmark_rows": benchmark_rows,
        "status": "pass" if not issues else "fail", "issues": issues,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Download split/dividend-adjusted Alpaca daily bars")
    parser.add_argument("--universe", type=Path, default=Path(__file__).with_name("universe.txt"))
    parser.add_argument("--years", type=int, default=10)
    parser.add_argument("--feed", choices=("sip", "iex"), default="sip")
    parser.add_argument("--output", type=Path, default=Path("data/daily_adjusted.csv"))
    args = parser.parse_args()
    symbols = load_symbols(args.universe)
    frame = download(symbols, args.years, args.feed)
    quality = validate_dataset(frame, symbols)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    frame.sort_values(["date", "symbol"]).to_csv(args.output, index=False)
    quality_path = args.output.with_name(f"{args.output.stem}_quality.json")
    quality_path.write_text(json.dumps(quality, indent=2) + "\n")
    print(json.dumps(quality, indent=2))
    if quality["status"] != "pass":
        raise RuntimeError(f"Dataset failed quality checks; see {quality_path}")


if __name__ == "__main__":
    main()
