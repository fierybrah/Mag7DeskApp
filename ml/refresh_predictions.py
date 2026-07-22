from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import joblib

from .fetch_alpaca_history import download
from .features import build_features
from .predict import score_latest, write_payload

# Must match the symbols server.js's STOCKS array serves on the Entry tab.
# Kept as an explicit constant (rather than derived from ml/universe.txt,
# which is the much larger training universe) so this script fetches only
# what the dashboard actually needs.
DEFAULT_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"]


def fetch_and_score(symbols: list[str], artifacts: Path, config: dict, feed: str, fetch_years: int) -> dict:
    metadata = json.loads((artifacts / "metadata.json").read_text())
    model = joblib.load(artifacts / "model.joblib")
    benchmark = metadata["benchmark_symbol"].upper()
    requested = {symbol.upper() for symbol in symbols}

    # A small trailing window is enough: predict.py only needs ~260 sessions
    # of history per symbol to fill every rolling feature, far short of the
    # full multi-year set used for training.
    frame = download(sorted(requested | {benchmark}), fetch_years, feed)
    featured = build_features(frame, benchmark)
    candidates = featured[~featured["symbol"].eq(benchmark) & featured["symbol"].isin(requested)]
    latest = candidates.sort_values("date").groupby("symbol", as_index=False).tail(1)
    if latest.empty:
        raise RuntimeError("No fresh daily bar was available for the requested symbols")
    return score_latest(latest, model, metadata, config)


def _run_git(args: list[str], repo_root: Path):
    return subprocess.run(["git", *args], cwd=repo_root, check=True, capture_output=True, text=True)


def publish(output: Path, repo_root: Path, branch: str) -> bool:
    """Commit and push the regenerated predictions file. Returns False if
    there was nothing new to publish (e.g. the market was closed).

    Pushes to the plain "origin" remote rather than building an authenticated
    URL: in GitHub Actions, actions/checkout already leaves origin configured
    with push credentials for the current run, so no token handling belongs
    in this script at all.
    """
    relative = output.relative_to(repo_root)
    _run_git(["config", "user.email", "ml-refresh@mag7-stock-desk.local"], repo_root)
    _run_git(["config", "user.name", "Mag7 ML Refresh Bot"], repo_root)
    _run_git(["add", str(relative)], repo_root)
    staged = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo_root)
    if staged.returncode == 0:
        print("No prediction changes to publish.")
        return False
    _run_git(["commit", "-m", f"Refresh ML predictions ({datetime.now(timezone.utc).date().isoformat()})"], repo_root)
    _run_git(["push", "origin", f"HEAD:{branch}"], repo_root)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch a small trailing window of daily bars, score the latest session with the "
                     "already-trained model, and (optionally) publish the result to git."
    )
    parser.add_argument("--symbols", nargs="*", default=DEFAULT_SYMBOLS)
    parser.add_argument("--artifacts", type=Path, default=Path(__file__).with_name("artifacts"))
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    parser.add_argument("--output", type=Path, default=Path("data/ml_predictions.json"))
    parser.add_argument("--feed", choices=("sip", "iex"), default="sip")
    parser.add_argument("--fetch-years", type=int, default=2)
    parser.add_argument("--publish", action="store_true", help="Commit and push the regenerated predictions file")
    parser.add_argument("--branch", default="main")
    args = parser.parse_args()

    config = json.loads(args.config.read_text())
    payload = fetch_and_score(args.symbols, args.artifacts, config, args.feed, args.fetch_years)
    write_payload(payload, args.output)
    print(json.dumps(payload, indent=2))

    if args.publish:
        repo_root = Path(__file__).resolve().parent.parent
        publish(args.output, repo_root, args.branch)


if __name__ == "__main__":
    main()
