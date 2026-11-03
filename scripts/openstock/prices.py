"""每週股價更新：下載近 5 年日線，寫入 public/data/prices.json。

來源依序嘗試：
1. Yahoo Finance chart 介面（日線、股票分割事件）。
2. Stooq 日線 CSV（若設定環境變數 STOOQ_APIKEY 會附上金鑰；無分割事件）。

- 免費資料僅供個人研究使用；網站標示來源，非即時報價。
- 收盤價為「分割調整、未還原股息」的收盤價（目前股數基礎），52 週高低點取日線最高、最低價。
- 分割事件（splits）一併輸出，前端用來把當時申報的 EPS 換算到目前股數基礎，估值才不會在分割前後錯位。
- 單檔失敗（下載失敗、資料過舊、格式不對）保留上次的價格，不影響其他檔。

用法：python -m openstock.prices [--output public/data/prices.json] [--ticker NVDA ...]
"""
import argparse
import csv
import io
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

from .pipeline import COMPANIES

ETFS = ["EWT", "SMH"]
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
STOOQ = "https://stooq.com/q/d/l/?s={symbol}&d1={start}&d2={end}&i=d"
SOURCES = {"yahoo": "Yahoo Finance", "stooq": "Stooq"}
HEADERS = {
    # Yahoo 會拒絕沒有瀏覽器樣式 User-Agent 的請求。
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept": "application/json,text/csv,*/*",
}


def summarize(bars, today: date, splits=None):
    """日線 [(date, high, low, close)] → 收盤、前一日收盤、52 週高低、近 5 年週收盤。"""
    if not bars:
        raise ValueError("no bars")
    for d, hi, lo, close in bars:
        if not (close > 0 and hi >= close >= lo > 0):
            raise ValueError(f"invalid bar {d} {hi} {lo} {close}")
    bars = sorted(bars)
    last = bars[-1]
    if (today - last[0]).days > 10:
        raise ValueError(f"stale data, last bar {last[0]}")
    year = [b for b in bars if b[0] > last[0] - timedelta(days=365)]
    weekly = {}
    for d, _, _, close in bars:
        if d > last[0] - timedelta(days=5 * 366):
            # 每週保留最後一個交易日（ISO 週）
            weekly[d.isocalendar()[:2]] = (d.isoformat(), round(close, 4))
    out = {
        "asof": last[0].isoformat(),
        "close": round(last[3], 4),
        "prev_close": round(bars[-2][3], 4) if len(bars) > 1 else None,
        "hi52": round(max(b[1] for b in year), 4),
        "lo52": round(min(b[2] for b in year), 4),
        "weekly": [list(v) for v in sorted(weekly.values())],
    }
    if splits is not None:
        out["splits"] = splits
    return out


def parse(text: str, today: date):
    """Stooq 日線 CSV → summarize()。格式不對就丟錯。"""
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
    return summarize(bars, today)


def parse_yahoo(payload: dict, today: date):
    """Yahoo chart JSON → summarize()。日期以交易所時區換算；缺值（停牌、盤中空白）略過。"""
    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise ValueError(f"yahoo error: {chart['error']}")
    results = chart.get("result") or []
    if len(results) != 1:
        raise ValueError("unexpected yahoo payload")
    r = results[0]
    offset = int(r.get("meta", {}).get("gmtoffset", 0))
    quote = (r.get("indicators", {}).get("quote") or [{}])[0]
    stamps = r.get("timestamp") or []
    highs, lows, closes = quote.get("high") or [], quote.get("low") or [], quote.get("close") or []
    if not (len(stamps) == len(highs) == len(lows) == len(closes)) or not stamps:
        raise ValueError("yahoo arrays missing or misaligned")
    by_day = {}
    for ts, hi, lo, close in zip(stamps, highs, lows, closes):
        if hi is None or lo is None or close is None:
            continue
        d = datetime.fromtimestamp(ts + offset, tz=timezone.utc).date()
        # 浮點誤差：收盤偶爾略高於最高價，夾回區間。
        hi, lo = max(hi, close), min(lo, close)
        by_day[d] = (d, hi, lo, close)
    splits = []
    for s in (r.get("events", {}).get("splits") or {}).values():
        num, den = s.get("numerator"), s.get("denominator")
        if not (num and den and num > 0 and den > 0):
            continue
        d = datetime.fromtimestamp(int(s["date"]) + offset, tz=timezone.utc).date()
        splits.append({"date": d.isoformat(), "ratio": round(num / den, 6)})
    splits.sort(key=lambda s: s["date"])
    return summarize(list(by_day.values()), today, splits)


def fetch_yahoo(ticker: str, client: httpx.Client, today: date):
    response = client.get(
        YAHOO.format(symbol=ticker),
        params={"range": "5y", "interval": "1d", "events": "split", "includePrePost": "false"},
    )
    response.raise_for_status()
    return parse_yahoo(response.json(), today)


def fetch_stooq(ticker: str, client: httpx.Client, today: date):
    # 只要近 5 年多的日線，回應小、下載快。
    url = STOOQ.format(
        symbol=f"{ticker.lower()}.us",
        start=(today - timedelta(days=5 * 366 + 14)).strftime("%Y%m%d"),
        end=today.strftime("%Y%m%d"),
    )
    key = os.environ.get("STOOQ_APIKEY")
    response = client.get(url, params={"apikey": key} if key else None)
    response.raise_for_status()
    return parse(response.text, today)


def fetch(ticker: str, client: httpx.Client, today: date):
    """依序嘗試各來源，回傳 (來源代號, 資料)；全部失敗丟出最後一個錯誤。"""
    errors = []
    for name, fn in (("yahoo", fetch_yahoo), ("stooq", fetch_stooq)):
        try:
            return name, fn(ticker, client, today)
        except Exception as exc:  # noqa: BLE001 - 換下一個來源
            errors.append(f"{name}: {type(exc).__name__}: {str(exc)[:120]}")
    raise RuntimeError("; ".join(errors))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", type=Path, default=Path("public/data/prices.json"))
    p.add_argument("--ticker", nargs="*", help="只更新指定代號（預設全部）")
    args = p.parse_args(argv)
    old = json.loads(args.output.read_text()) if args.output.exists() else {"tickers": {}}
    tickers = dict(old.get("tickers", {}))
    today = datetime.now(timezone.utc).date()
    targets = args.ticker or [*COMPANIES, *ETFS]
    failed, used = [], set()
    timeout = httpx.Timeout(20, connect=10)
    with httpx.Client(timeout=timeout, follow_redirects=True, headers=HEADERS) as client:
        for t in targets:
            try:
                source, new = fetch(t, client, today)
            except Exception as exc:  # noqa: BLE001 - 單檔失敗保留舊值
                failed.append(t)
                print(f"::warning::{t} price update failed; previous price kept: {exc}", file=sys.stderr, flush=True)
                continue
            prev = tickers.get(t)
            if prev and abs(new["close"] / prev["close"] - 1) > 0.5 and not new.get("splits"):
                print(f"::warning::{t} moved more than 50% since {prev['asof']} (split?) — please review", file=sys.stderr)
            if "splits" not in new and prev and prev.get("splits"):
                new["splits"] = prev["splits"]  # Stooq 沒有分割事件，沿用上次。
            new["source"] = SOURCES[source]
            used.add(SOURCES[source])
            tickers[t] = new
            print(f"{t}: {new['close']} @ {new['asof']} ({SOURCES[source]})", flush=True)
    if len(failed) == len(targets):
        print("All price downloads failed; prices.json unchanged", file=sys.stderr)
        return 1
    names = "、".join(sorted(used)) or "免費日線資料"
    out = {
        "version": 1,
        "source": "https://finance.yahoo.com/" if "Yahoo Finance" in used else "https://stooq.com/",
        "note": f"股價來自 {names} 免費日線資料，每週自動更新；僅供個人研究，非即時報價。收盤價已按股票分割調整、未還原股息。",
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "tickers": dict(sorted(tickers.items())),
    }
    args.output.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
