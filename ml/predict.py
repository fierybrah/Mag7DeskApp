from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from .features import build_features


# The 200-session SMA is the longest trailing lookback; a buffer keeps every
# rolling feature fully formed on the scored (latest) row.
TRAILING_SESSIONS = 260


def recommendation(probabilities: dict[str, float], threshold: float) -> str:
    if probabilities.get("BUY", 0) >= threshold:
        return "BUY"
    if probabilities.get("SELL", 0) >= threshold:
        return "SELL"
    return "HOLD"


def confidence_label(confidence: float, threshold: float) -> str:
    if confidence >= threshold + 0.15:
        return "High"
    if confidence >= threshold:
        return "Moderate"
    return "Low"


def main() -> None:
    parser = argparse.ArgumentParser(description="Score the latest daily row for each requested symbol")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, default=Path(__file__).with_name("artifacts"))
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--symbols", nargs="*", default=[])
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    metadata = json.loads((args.artifacts / "metadata.json").read_text())
    model = joblib.load(args.artifacts / "model.joblib")
    benchmark = metadata["benchmark_symbol"].upper()
    requested = {symbol.upper() for symbol in args.symbols}
    raw = pd.read_csv(args.data)
    # Trim before building features: only the requested symbols (plus the
    # benchmark) and the trailing window the longest lookback needs, instead
    # of computing rolling features for the whole universe and full history.
    raw["symbol"] = raw["symbol"].astype(str).str.upper().str.strip()
    if requested:
        raw = raw[raw["symbol"].isin(requested | {benchmark})]
    raw = raw.assign(_date=pd.to_datetime(raw["date"], errors="coerce"))
    raw = raw.sort_values(["symbol", "_date"]).groupby("symbol", group_keys=False).tail(TRAILING_SESSIONS)
    featured = build_features(raw.drop(columns="_date"), benchmark)
    candidates = featured[~featured["symbol"].eq(benchmark)]
    if requested:
        candidates = candidates[candidates["symbol"].isin(requested)]
    latest = candidates.sort_values("date").groupby("symbol", as_index=False).tail(1)
    probabilities = model.predict_proba(latest)
    generated_at = datetime.now(timezone.utc).isoformat()
    predictions = []
    for row_position, (_, row) in enumerate(latest.iterrows()):
        probability_map = {
            name: round(float(probabilities[row_position, index]), 6)
            for index, name in enumerate(model.classes_)
        }
        confidence = max(probability_map.values())
        threshold = config["probability_threshold"]
        predictions.append({
            "symbol": row["symbol"],
            "asOf": str(pd.Timestamp(row["date"]).date()),
            "horizonTradingDays": metadata["horizon_days"],
            "recommendation": recommendation(probability_map, threshold),
            "probabilities": {key.lower(): value for key, value in probability_map.items()},
            "confidence": confidence_label(confidence, threshold),
            "dataQuality": "ready" if np.isfinite(row[metadata["feature_columns"]].astype(float)).mean() >= 0.8 else "limited",
        })
    payload = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "model": {"name": metadata["model_name"], "version": metadata["model_version"]},
        "benchmark": metadata["benchmark_symbol"],
        "probabilityThreshold": config["probability_threshold"],
        "predictions": predictions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Write-then-rename so a concurrent server read never sees a partial file.
    temp_output = args.output.with_name(f"{args.output.name}.tmp")
    temp_output.write_text(json.dumps(payload, indent=2) + "\n")
    temp_output.replace(args.output)
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()

