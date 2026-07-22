from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from .features import add_labels, build_features
from .modeling import evaluate_walk_forward, fit_final_model


def main() -> None:
    parser = argparse.ArgumentParser(description="Train and validate the daily stock outlook model")
    parser.add_argument("--data", type=Path, required=True, help="Point-in-time daily OHLCV CSV")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("artifacts"))
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    raw = pd.read_csv(args.data)
    featured = build_features(raw, config["benchmark_symbol"])
    labeled = add_labels(
        featured, config["horizon_days"], config["buy_excess_return"],
        config["sell_excess_return"], config["benchmark_symbol"],
    )
    predictions, metrics = evaluate_walk_forward(labeled, config)
    args.output.mkdir(parents=True, exist_ok=True)
    predictions.to_csv(args.output / "walk_forward_predictions.csv", index=False)
    (args.output / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    winner = min(metrics, key=lambda name: metrics[name]["log_loss"])
    metadata = fit_final_model(labeled, config, args.output, estimator_name=winner)
    print(json.dumps({"artifacts": str(args.output), "metadata": metadata, "metrics": metrics}, indent=2))


if __name__ == "__main__":
    main()
