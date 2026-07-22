# Daily ML Outlook

This directory contains an offline, point-in-time machine-learning pipeline for
the stock dashboard. It predicts `BUY`, `HOLD`, and `SELL` probabilities for a
20-trading-day horizon relative to SPY. It does not replace the transparent
Setup Quality score until walk-forward results demonstrate a durable advantage.

## Input contract

Training and prediction accept a CSV with one adjusted daily bar per symbol and
date:

```text
date,symbol,open,high,low,close,volume
2024-01-02,AAPL,185.14,188.44,183.89,185.64,82488700
2024-01-02,SPY,472.16,473.67,470.49,472.65,123456789
```

Prices must be adjusted consistently for splits and dividends. SPY must be
present on every market date. Training data should include a broad,
survivorship-aware liquid US equity universe rather than only the Magnificent
Seven. Do not attach current fundamentals, analyst targets, or news to old rows.
Those sources may only be added when point-in-time histories are available.

Download the development universe with:

```bash
.venv/bin/python -m ml.fetch_history --years 10
```

For the recommended authenticated Alpaca path, export the same credentials used
by the Node application and run:

```bash
export ALPACA_API_KEY="..."
export ALPACA_API_SECRET="..."
.venv/bin/python -m ml.fetch_alpaca_history --years 10 --feed sip
```

Alternatively, enter the credentials in the visible `alpaca.env` file in the
project root. Both `alpaca.env` and `.env` are excluded from Git, and the
downloader never prints credential values.

The downloader requests `adjustment=all`, follows Alpaca pagination, and writes
`data/daily_adjusted_quality.json`. Training must not proceed unless that report
has `"status": "pass"`.

The checked-in `universe.txt` is a liquid large-cap development universe, not a
survivorship-bias-free research dataset. It is suitable for shadow-model
prototyping, while a licensed point-in-time constituent dataset is still needed
before making defensible historical performance claims.

## Setup

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r ml/requirements.txt
```

## Train and validate

```bash
.venv/bin/python -m ml.train --data data/daily_adjusted.csv
```

The command builds trailing features, attaches forward labels, evaluates both a
logistic baseline and gradient-boosted model with expanding date folds, leaves a
20-session gap before every validation window, calibrates the final model on a
later untouched window, and writes:

```text
ml/artifacts/model.joblib
ml/artifacts/metadata.json
ml/artifacts/metrics.json
ml/artifacts/walk_forward_predictions.csv
```

Review `metrics.json` and the walk-forward prediction file before promoting any
model. Accuracy alone is not a promotion criterion; inspect log loss, balanced
accuracy, class precision/recall, excess returns after assumed costs, turnover,
and drawdown.

## Generate dashboard predictions

```bash
.venv/bin/python -m ml.predict \
  --data data/daily_adjusted.csv \
  --symbols AAPL MSFT GOOGL AMZN NVDA META TSLA \
  --output data/ml_predictions.json
```

The output is versioned JSON designed for the Node server to read. A prediction
becomes `BUY` or `SELL` only when its respective calibrated probability is at
least the threshold in `config.json`; otherwise it abstains with `HOLD`.

## Test

```bash
.venv/bin/python -m unittest discover -s ml/tests -v
```

The fixtures verify that adding future rows cannot change historical feature
values and that the validation embargo is enforced.
