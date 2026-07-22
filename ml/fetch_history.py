from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd


YAHOO_CHART = "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"
USER_AGENT = "Mozilla/5.0 (compatible; Mag7StockDesk/1.0; historical-model-development)"


def load_symbols(path: Path) -> list[str]:
    symbols = []
    for line in path.read_text().splitlines():
        symbol = line.partition("#")[0].strip().upper()
        if symbol and symbol not in symbols:
            symbols.append(symbol)
    if "SPY" not in symbols:
        raise ValueError("The universe must include SPY")
    return symbols


def fetch_symbol(symbol: str, start: datetime, end: datetime, retries: int = 4) -> pd.DataFrame:
    yahoo_symbol = symbol
    query = urllib.parse.urlencode({
        "period1": int(start.timestamp()),
        "period2": int(end.timestamp()),
        "interval": "1d",
        "events": "div,splits",
        "includeAdjustedClose": "true",
    })
    url = f"{YAHOO_CHART.format(symbol=urllib.parse.quote(yahoo_symbol))}?{query}"
    last_error = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
            result = payload["chart"]["result"][0]
            timestamps = result.get("timestamp") or []
            quote = result["indicators"]["quote"][0]
            adjusted = (result["indicators"].get("adjclose") or [{}])[0].get("adjclose") or quote["close"]
            rows = []
            for index, timestamp in enumerate(timestamps):
                close = quote["close"][index]
                adjusted_close = adjusted[index]
                if close is None or adjusted_close is None or close <= 0:
                    continue
                factor = adjusted_close / close
                values = {name: quote[name][index] for name in ("open", "high", "low")}
                if any(value is None for value in values.values()):
                    continue
                rows.append({
                    "date": datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat(),
                    "symbol": symbol,
                    "open": values["open"] * factor,
                    "high": values["high"] * factor,
                    "low": values["low"] * factor,
                    "close": adjusted_close,
                    "volume": quote["volume"][index] or 0,
                })
            if not rows:
                raise ValueError("provider returned no usable daily bars")
            return pd.DataFrame(rows)
        except (KeyError, IndexError, TypeError, ValueError, urllib.error.URLError) as error:
            last_error = error
            if attempt + 1 < retries:
                time.sleep(1.5 * (2 ** attempt))
    raise RuntimeError(f"{symbol}: {last_error}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download adjusted daily bars for model development")
    parser.add_argument("--universe", type=Path, default=Path(__file__).with_name("universe.txt"))
    parser.add_argument("--years", type=int, default=10)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--output", type=Path, default=Path("data/daily_adjusted.csv"))
    args = parser.parse_args()
    symbols = load_symbols(args.universe)
    end = datetime.now(timezone.utc) + timedelta(days=1)
    start = end - timedelta(days=round(args.years * 365.25))
    frames = []
    failures = []
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as executor:
        futures = {executor.submit(fetch_symbol, symbol, start, end): symbol for symbol in symbols}
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                frame = future.result()
                frames.append(frame)
                print(f"{symbol}: {len(frame)} rows")
            except Exception as error:
                failures.append(str(error))
                print(f"FAILED {error}")
    if not frames or not any(frame["symbol"].eq("SPY").any() for frame in frames):
        raise RuntimeError("No benchmark data was downloaded; cannot build the dataset")
    combined = pd.concat(frames, ignore_index=True).sort_values(["date", "symbol"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(args.output, index=False)
    summary = {
        "output": str(args.output), "rows": len(combined),
        "symbols": int(combined["symbol"].nunique()), "failures": failures,
        "first_date": combined["date"].min(), "last_date": combined["date"].max(),
    }
    print(json.dumps(summary, indent=2))
    if len(frames) < max(10, len(symbols) // 2):
        raise RuntimeError("Too many symbols failed; dataset was written but should not be used for training")


if __name__ == "__main__":
    main()
