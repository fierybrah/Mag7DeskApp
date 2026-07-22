from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.frozen import FrozenEstimator
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score, classification_report, log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .features import FEATURE_COLUMNS


CLASSES = ["BUY", "HOLD", "SELL"]


@dataclass(frozen=True)
class TimeFold:
    train_indices: np.ndarray
    test_indices: np.ndarray
    train_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp


def expanding_date_folds(
    dates: pd.Series,
    folds: int,
    test_days: int,
    gap_days: int,
) -> list[TimeFold]:
    unique_dates = pd.Index(pd.to_datetime(dates).sort_values().unique())
    required = folds * test_days + gap_days + 1
    if len(unique_dates) < required:
        raise ValueError(f"Need at least {required} unique dates; found {len(unique_dates)}")
    first_test_position = len(unique_dates) - folds * test_days
    result = []
    date_values = pd.to_datetime(dates)
    for fold in range(folds):
        test_start_pos = first_test_position + fold * test_days
        test_end_pos = test_start_pos + test_days
        train_end_pos = test_start_pos - gap_days
        train_dates = unique_dates[:train_end_pos]
        test_dates = unique_dates[test_start_pos:test_end_pos]
        train_mask = date_values.isin(train_dates).to_numpy()
        test_mask = date_values.isin(test_dates).to_numpy()
        result.append(TimeFold(
            np.flatnonzero(train_mask), np.flatnonzero(test_mask),
            pd.Timestamp(train_dates[-1]), pd.Timestamp(test_dates[0]), pd.Timestamp(test_dates[-1]),
        ))
    return result


def _baseline_pipeline() -> Pipeline:
    preprocessor = ColumnTransformer([
        ("numeric", Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
        ]), FEATURE_COLUMNS),
        ("symbol", OneHotEncoder(handle_unknown="ignore"), ["symbol"]),
    ])
    return Pipeline([
        ("features", preprocessor),
        ("model", LogisticRegression(max_iter=2000, class_weight="balanced", random_state=42)),
    ])


def _boosted_pipeline(random_state: int) -> Pipeline:
    columns = FEATURE_COLUMNS + ["symbol"]
    preprocessor = ColumnTransformer([
        ("numeric", SimpleImputer(strategy="median", add_indicator=True), FEATURE_COLUMNS),
        ("symbol", OneHotEncoder(handle_unknown="ignore", sparse_output=False), ["symbol"]),
    ], sparse_threshold=0)
    return Pipeline([
        ("features", preprocessor),
        ("model", HistGradientBoostingClassifier(
            learning_rate=0.05,
            max_iter=300,
            max_leaf_nodes=15,
            min_samples_leaf=40,
            l2_regularization=1.0,
            class_weight="balanced",
            early_stopping=False,
            random_state=random_state,
        )),
    ])


def evaluate_walk_forward(rows: pd.DataFrame, config: dict) -> tuple[pd.DataFrame, dict]:
    dataset = rows.dropna(subset=["label"]).sort_values(["date", "symbol"]).reset_index(drop=True)
    folds = expanding_date_folds(
        dataset["date"], config["validation_folds"], config["validation_days"], config["horizon_days"]
    )
    predictions = []
    for fold_number, fold in enumerate(folds, start=1):
        train = dataset.iloc[fold.train_indices]
        test = dataset.iloc[fold.test_indices]
        for name, estimator in (("logistic", _baseline_pipeline()), ("boosted", _boosted_pipeline(config["random_state"]))):
            estimator.fit(train, train["label"])
            probabilities = estimator.predict_proba(test)
            predicted = estimator.classes_[np.argmax(probabilities, axis=1)]
            part = test[["date", "symbol", "label", "forward_excess_return"]].copy()
            part["model"] = name
            part["fold"] = fold_number
            part["prediction"] = predicted
            for class_name in CLASSES:
                class_position = list(estimator.classes_).index(class_name)
                part[f"probability_{class_name.lower()}"] = probabilities[:, class_position]
            predictions.append(part)
    result = pd.concat(predictions, ignore_index=True)
    metrics = {}
    for name, group in result.groupby("model"):
        probability_columns = [f"probability_{name.lower()}" for name in CLASSES]
        metrics[name] = {
            "rows": int(len(group)),
            "accuracy": float(accuracy_score(group["label"], group["prediction"])),
            "balanced_accuracy": float(balanced_accuracy_score(group["label"], group["prediction"])),
            "log_loss": float(log_loss(group["label"], group[probability_columns], labels=CLASSES)),
            "classification_report": classification_report(group["label"], group["prediction"], output_dict=True, zero_division=0),
        }
    return result, metrics


def fit_final_model(rows: pd.DataFrame, config: dict, artifact_dir: Path, estimator_name: str = "boosted") -> dict:
    dataset = rows.dropna(subset=["label"]).sort_values(["date", "symbol"]).reset_index(drop=True)
    if len(dataset) < config["minimum_training_rows"]:
        raise ValueError(f"Need {config['minimum_training_rows']} training rows; found {len(dataset)}")
    dates = pd.Index(dataset["date"].sort_values().unique())
    calibration_days = min(config["validation_days"], max(30, len(dates) // 10))
    calibration_start = dates[-calibration_days]
    fit_cutoff_position = len(dates) - calibration_days - config["horizon_days"]
    if fit_cutoff_position <= 0:
        raise ValueError("Not enough dates for a leakage-safe calibration split")
    fit_end = dates[fit_cutoff_position - 1]
    fit_rows = dataset[dataset["date"] <= fit_end]
    calibration_rows = dataset[dataset["date"] >= calibration_start]
    if estimator_name == "logistic":
        base_model = _baseline_pipeline()
    elif estimator_name == "boosted":
        base_model = _boosted_pipeline(config["random_state"])
    else:
        raise ValueError(f"Unknown estimator: {estimator_name}")
    base_model.fit(fit_rows, fit_rows["label"])
    # FrozenEstimator tells current scikit-learn releases that this estimator
    # was fitted on an earlier time window and must not be refitted on the
    # later calibration window.
    calibrated = CalibratedClassifierCV(FrozenEstimator(base_model), method="sigmoid")
    calibrated.fit(calibration_rows, calibration_rows["label"])

    artifact_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(calibrated, artifact_dir / "model.joblib")
    metadata = {
        "model_name": config["model_name"],
        "model_version": config["model_version"],
        "estimator": estimator_name,
        "trained_through": str(pd.Timestamp(dataset["date"].max()).date()),
        "fit_through": str(pd.Timestamp(fit_end).date()),
        "calibration_from": str(pd.Timestamp(calibration_start).date()),
        "training_rows": int(len(dataset)),
        "symbols": sorted(dataset["symbol"].unique().tolist()),
        "classes": calibrated.classes_.tolist(),
        "feature_columns": FEATURE_COLUMNS,
        "horizon_days": config["horizon_days"],
        "buy_excess_return": config["buy_excess_return"],
        "sell_excess_return": config["sell_excess_return"],
        "benchmark_symbol": config["benchmark_symbol"],
    }
    (artifact_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    return metadata
