from __future__ import annotations

import numpy as np
import pandas as pd


REQUIRED_COLUMNS = {"date", "symbol", "open", "high", "low", "close", "volume"}
FEATURE_COLUMNS = [
    "return_1d", "return_5d", "return_10d", "return_20d", "return_60d",
    "price_vs_sma_10", "price_vs_sma_20", "price_vs_sma_50", "price_vs_sma_200",
    "sma_20_slope_5d", "sma_50_slope_10d", "sma_20_vs_50", "rsi_14",
    "volatility_5d", "volatility_20d", "volatility_60d", "atr_14_pct",
    "drawdown_20d", "drawdown_60d", "volume_ratio_20d", "dollar_volume_log",
    "intraday_range", "overnight_gap", "benchmark_return_5d", "benchmark_return_20d",
    "excess_return_5d", "excess_return_20d", "benchmark_volatility_20d",
    "day_of_week", "month"
]


def validate_market_data(frame: pd.DataFrame) -> pd.DataFrame:
    missing = REQUIRED_COLUMNS.difference(frame.columns)
    if missing:
        raise ValueError(f"Market data is missing columns: {', '.join(sorted(missing))}")
    data = frame.copy()
    data["date"] = pd.to_datetime(data["date"], utc=True).dt.tz_convert(None).dt.normalize()
    data["symbol"] = data["symbol"].astype(str).str.upper().str.strip()
    for column in ("open", "high", "low", "close", "volume"):
        data[column] = pd.to_numeric(data[column], errors="coerce")
    data = data.dropna(subset=["date", "symbol", "close"])
    data = data.sort_values(["symbol", "date"]).drop_duplicates(["symbol", "date"], keep="last")
    if (data["close"] <= 0).any():
        raise ValueError("Closing prices must be positive")
    return data.reset_index(drop=True)


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    loss = -delta.clip(upper=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    relative_strength = gain / loss.replace(0, np.nan)
    result = 100 - 100 / (1 + relative_strength)
    return result.where(loss.ne(0), 100.0)


def _symbol_features(group: pd.DataFrame) -> pd.DataFrame:
    rows = group.sort_values("date").copy()
    close = rows["close"]
    returns = close.pct_change()
    for period in (1, 5, 10, 20, 60):
        rows[f"return_{period}d"] = close.pct_change(period)
    for period in (10, 20, 50, 200):
        sma = close.rolling(period, min_periods=period).mean()
        rows[f"price_vs_sma_{period}"] = close / sma - 1
        if period == 20:
            rows["sma_20_slope_5d"] = sma.pct_change(5)
        if period == 50:
            rows["sma_50_slope_10d"] = sma.pct_change(10)
    sma20 = close.rolling(20, min_periods=20).mean()
    sma50 = close.rolling(50, min_periods=50).mean()
    rows["sma_20_vs_50"] = sma20 / sma50 - 1
    rows["rsi_14"] = _rsi(close)
    for period in (5, 20, 60):
        rows[f"volatility_{period}d"] = returns.rolling(period, min_periods=period).std() * np.sqrt(252)
    prior_close = close.shift(1)
    true_range = pd.concat([
        rows["high"] - rows["low"],
        (rows["high"] - prior_close).abs(),
        (rows["low"] - prior_close).abs(),
    ], axis=1).max(axis=1)
    rows["atr_14_pct"] = true_range.rolling(14, min_periods=14).mean() / close
    for period in (20, 60):
        rows[f"drawdown_{period}d"] = close / close.rolling(period, min_periods=period).max() - 1
    rows["volume_ratio_20d"] = rows["volume"] / rows["volume"].rolling(20, min_periods=20).mean()
    rows["dollar_volume_log"] = np.log1p(rows["close"] * rows["volume"].clip(lower=0))
    rows["intraday_range"] = (rows["high"] - rows["low"]) / close
    rows["overnight_gap"] = rows["open"] / prior_close - 1
    rows["day_of_week"] = rows["date"].dt.dayofweek
    rows["month"] = rows["date"].dt.month
    return rows


def build_features(frame: pd.DataFrame, benchmark_symbol: str = "SPY") -> pd.DataFrame:
    """Build strictly trailing features; no future values are used here."""
    data = validate_market_data(frame)
    # An explicit loop keeps the grouping key in the frame across pandas
    # versions (pandas 3 no longer passes grouping columns to apply()).
    featured = pd.concat(
        [_symbol_features(group) for _, group in data.groupby("symbol", sort=False)],
        ignore_index=True,
    )

    benchmark = featured.loc[featured["symbol"] == benchmark_symbol.upper(), [
        "date", "return_5d", "return_20d", "volatility_20d"
    ]].rename(columns={
        "return_5d": "benchmark_return_5d",
        "return_20d": "benchmark_return_20d",
        "volatility_20d": "benchmark_volatility_20d",
    })
    if benchmark.empty:
        raise ValueError(f"Benchmark {benchmark_symbol} is required in the input data")
    featured = featured.merge(benchmark, on="date", how="left", validate="many_to_one")
    featured["excess_return_5d"] = featured["return_5d"] - featured["benchmark_return_5d"]
    featured["excess_return_20d"] = featured["return_20d"] - featured["benchmark_return_20d"]
    return featured.sort_values(["date", "symbol"]).reset_index(drop=True)


def add_labels(
    featured: pd.DataFrame,
    horizon_days: int = 20,
    buy_threshold: float = 0.02,
    sell_threshold: float = -0.02,
    benchmark_symbol: str = "SPY",
) -> pd.DataFrame:
    """Attach forward excess-return labels for training only."""
    rows = featured.sort_values(["symbol", "date"]).copy()
    rows["forward_return"] = rows.groupby("symbol")["close"].transform(
        lambda values: values.shift(-horizon_days) / values - 1
    )
    benchmark = rows.loc[rows["symbol"] == benchmark_symbol.upper(), ["date", "forward_return"]].rename(
        columns={"forward_return": "benchmark_forward_return"}
    )
    rows = rows.merge(benchmark, on="date", how="left", validate="many_to_one")
    rows["forward_excess_return"] = rows["forward_return"] - rows["benchmark_forward_return"]
    rows["label"] = np.select(
        [rows["forward_excess_return"] > buy_threshold, rows["forward_excess_return"] < sell_threshold],
        ["BUY", "SELL"],
        default="HOLD",
    )
    unavailable = rows["forward_excess_return"].isna()
    rows.loc[unavailable, "label"] = pd.NA
    return rows.sort_values(["date", "symbol"]).reset_index(drop=True)
