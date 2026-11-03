"""每週股價更新：從 Stooq 下載日線 CSV，寫入 public/data/prices.json。

- Stooq 免費資料僅供個人研究使用；網站標示來源，不提供再散布。
- 單檔失敗（下載失敗、資料過舊、格式不對）保留上次的價格，不影響其他檔。
- 收盤價為未還原權值的原始收盤；52 週高低點取日線最高、最低價。

用法：python -m openstock.prices [--output public/data/prices.json]
"""
import argparse
import csv
import io
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

from .pipeline import COMPANIES

ETFS = ["EWT", "SMH"]
SOURCE = "https://stooq.com/"
URL = "https://stooq.com/q/d/l/?s={symbol}&d1={start}&d2={end}&i=d"


def parse(text: str, today: date):
    """Stooq 日線 CSV → 收盤、52 週高低、近 5 年週收盤。格式不對就丟錯。"""
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or "Close" not in rows[0]:
        raise ValueError(f"unexpected response: {text[:80]!r}")
    bars = []
    for r in rows:
        d = date.fromisoformat(r["Date"])
        hi, lo, close = float(r["High"]), float(r["Low"]), float(r["Close"])
        if not (close > 0 and hi >= close >= lo > 0):
            raise ValueError(f"invalid bar {r}")
        bars.append((d, hi, lo, close))
    bars.sort()
    last = bars[-1]
    if (today - last[0]).days > 10:
        raise ValueError(f"stale data, last bar {last[0]}")
    year = [b for b in bars if b[0] > last[0] - timedelta(days=365)]
    weekly = {}
    for d, _, _, close in bars:
        if d > last[0] - timedelta(days=5 * 366):
            # 每週保留最後一個交易日（ISO 週）
            weekly[d.isocalendar()[:2]] = (d.isoformat(), close)
    return {
        "asof": last[0].isoformat(),
        "close": last[3],
        "hi52": max(b[1] for b in year),
        "lo52": min(b[2] for b in year),
        "weekly": [list(v) for v in sorted(weekly.values())],
    }


def fetch(ticker: str, client: httpx.Client, today: date):
    # 只要近 5 年多的日線，回應小、下載快。
    url = URL.format(symbol=f"{ticker.lower()}.us",
                     start=(today - timedelta(days=5 * 366 + 14)).strftime("%Y%m%d"), end=today.strftime("%Y%m%d"))
    response = client.get(url)
    response.raise_for_status()
    return parse(response.text, today)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", type=Path, default=Path("public/data/prices.json"))
    args = p.parse_args()
    old = json.loads(args.output.read_text()) if args.output.exists() else {"tickers": {}}
    tickers = dict(old.get("tickers", {}))
    today = datetime.now(timezone.utc).date()
    failed = []
    timeout = httpx.Timeout(20, connect=10)
    with httpx.Client(timeout=timeout, follow_redirects=True, headers={"User-Agent": "OpenStock Analytics price update"}) as client:
        for t in [*COMPANIES, *ETFS]:
            try:
                new = fetch(t, client, today)
            except Exception as exc:  # noqa: BLE001 - 單檔失敗保留舊值
                failed.append(t)
                print(f"::warning::{t} price update failed; previous price kept: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
                continue
            prev = tickers.get(t)
            if prev and abs(new["close"] / prev["close"] - 1) > 0.5:
                print(f"::warning::{t} moved more than 50% since {prev['asof']} (split?) — please review", file=sys.stderr)
            tickers[t] = new
            print(f"{t}: {new['close']} @ {new['asof']}", flush=True)
    if len(failed) == len(COMPANIES) + len(ETFS):
        print("All price downloads failed; prices.json unchanged", file=sys.stderr)
        return 1
    out = {
        "version": 1,
        "source": SOURCE,
        "note": "股價來自 Stooq 免費日線資料，每週自動更新；僅供個人研究，非即時報價，未還原權值。",
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tickers": dict(sorted(tickers.items())),
    }
    args.output.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
