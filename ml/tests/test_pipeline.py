from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import pandas as pd

from ml.features import FEATURE_COLUMNS, add_labels, build_features
from ml.fetch_alpaca_history import bars_to_frame, validate_dataset
from ml.modeling import expanding_date_folds, fit_final_model


def synthetic_market_data(days: int = 320) -> pd.DataFrame:
    dates = pd.bdate_range("2020-01-01", periods=days)
    frames = []
    for number, symbol in enumerate(("SPY", "AAPL", "MSFT"), start=1):
        close = 100 + number * 5 + np.arange(days) * (0.03 + number * 0.01) + np.sin(np.arange(days) / 9)
        frames.append(pd.DataFrame({
            "date": dates,
            "symbol": symbol,
            "open": close * 0.999,
            "high": close * 1.01,
            "low": close * 0.99,
            "close": close,
            "volume": 1_000_000 + number * 10_000 + np.arange(days) * 100,
        }))
    return pd.concat(frames, ignore_index=True)


class FeatureTests(unittest.TestCase):
    def test_alpaca_bars_are_normalized(self):
        frame = bars_to_frame({"bars": {"SPY": [{
            "t": "2026-01-02T05:00:00Z", "o": 100, "h": 102, "l": 99, "c": 101, "v": 1234
        }]}})
        self.assertEqual(frame.iloc[0].to_dict(), {
            "date": "2026-01-02", "symbol": "SPY", "open": 100, "high": 102,
            "low": 99, "close": 101, "volume": 1234,
        })

    def test_features_and_labels_are_present(self):
        featured = build_features(synthetic_market_data())
        self.assertTrue(set(FEATURE_COLUMNS).issubset(featured.columns))
        labeled = add_labels(featured, horizon_days=20)
        self.assertIn("label", labeled.columns)
        latest = labeled.groupby("symbol").tail(20)
        self.assertTrue(latest["label"].isna().all())

    def test_feature_values_do_not_change_when_future_rows_are_added(self):
        data = synthetic_market_data()
        early = build_features(data[data["date"] <= data["date"].sort_values().unique()[-21]])
        full = build_features(data)
        cutoff = early["date"].max()
        columns = ["date", "symbol"] + FEATURE_COLUMNS
        left = early[columns].sort_values(["date", "symbol"]).reset_index(drop=True)
        right = full[full["date"] <= cutoff][columns].sort_values(["date", "symbol"]).reset_index(drop=True)
        pd.testing.assert_frame_equal(left, right)

    def test_walk_forward_gap_is_enforced(self):
        dates = pd.Series(pd.bdate_range("2020-01-01", periods=200).repeat(2))
        folds = expanding_date_folds(dates, folds=3, test_days=20, gap_days=10)
        for fold in folds:
            self.assertLess(fold.train_end, fold.test_start)
            self.assertGreaterEqual(len(pd.bdate_range(fold.train_end, fold.test_start)) - 2, 10)

    def test_final_model_artifacts_can_be_fitted(self):
        dates = pd.bdate_range("2018-01-01", periods=360)
        symbols = ("AAPL", "MSFT", "NVDA")
        rows = pd.DataFrame([(date, symbol) for date in dates for symbol in symbols], columns=["date", "symbol"])
        position = np.arange(len(rows))
        for feature_number, feature in enumerate(FEATURE_COLUMNS, start=1):
            rows[feature] = np.sin(position / (feature_number + 3))
        rows["label"] = np.resize(np.array(["BUY", "HOLD", "SELL"]), len(rows))
        config = {
            "model_name": "test_model", "model_version": "test", "minimum_training_rows": 500,
            "validation_days": 40, "horizon_days": 20, "random_state": 42,
            "buy_excess_return": 0.02, "sell_excess_return": -0.02, "benchmark_symbol": "SPY",
        }
        with TemporaryDirectory() as directory:
            metadata = fit_final_model(rows, config, Path(directory), estimator_name="logistic")
            self.assertEqual(metadata["training_rows"], len(rows))
            self.assertEqual(metadata["estimator"], "logistic")
            self.assertTrue((Path(directory) / "model.joblib").exists())
            self.assertTrue((Path(directory) / "metadata.json").exists())


if __name__ == "__main__":
    unittest.main()
