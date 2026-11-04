"""每週股價更新：下載近 5 年日線，寫入 public/data/prices.json。

來源依序嘗試：
1. Yahoo Finance chart 介面（先取得 cookie／crumb；日線、股票分割事件）。
2. Cboe 延遲行情 CDN（日線；未調整分割時以已核對的分割表換算）。
3. Nasdaq 歷史行情介面（日線，無分割事件）。
4. Stooq 日線 CSV（若設定環境變數 STOOQ_APIKEY 會附上金鑰；無分割事件）。

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
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

from .pipeline import COMPANIES

ETFS = ["EWT", "SMH", "SPY"]  # SPY 作為計算 Beta 的市場基準
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv"
YAHOO = "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"
NASDAQ = "https://api.nasdaq.com/api/quote/{symbol}/historical"
CBOE = "https://cdn.cboe.com/api/global/delayed_quotes/charts/historical/{symbol}.json"
STOOQ = "https://stooq.com/q/d/l/?s={symbol}&d1={start}&d2={end}&i=d"
SOURCES = {"yahoo": "Yahoo Finance", "cboe": "Cboe", "nasdaq": "Nasdaq", "stooq": "Stooq"}
# 已人工核對的股票分割（第一個以新股數交易的日期、1 股拆成幾股）。
# 五年價格區間以外的分割也要列：早期季度 EPS 可能在分割前申報，需換算到目前股數基礎。
KNOWN_SPLITS = {
    "AAPL": [{"date": "2020-08-31", "ratio": 4.0}],
    "TSLA": [{"date": "2020-08-31", "ratio": 5.0}, {"date": "2022-08-25", "ratio": 3.0}],
    "NVDA": [{"date": "2021-07-20", "ratio": 4.0}, {"date": "2024-06-10", "ratio": 10.0}],
    "GOOGL": [{"date": "2022-07-18", "ratio": 20.0}],
    "GOOG": [{"date": "2022-07-18", "ratio": 20.0}],
    "AMZN": [{"date": "2022-06-06", "ratio": 20.0}],
}


def merge_splits(*lists):
    """合併多個來源的分割事件；同一天以先出現者為準。"""
    out = {}
    for items in lists:
        for s in items or []:
            out.setdefault(s["date"], {"date": s["date"], "ratio": float(s["ratio"])})
    return [out[d] for d in sorted(out)]
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


class Yahoo:
    """Yahoo 需要先拿 cookie 再取 crumb；沒有時常回 429。整個程序共用一組 session。"""

    def __init__(self, client: httpx.Client):
        self.client = client
        self.crumb = None
        self.ready = False

    def _session(self):
        if self.ready:
            return
        self.ready = True
        for url in ("https://fc.yahoo.com", "https://finance.yahoo.com/"):
            try:
                self.client.get(url)
            except httpx.HTTPError:
                pass
        try:
            r = self.client.get("https://query2.finance.yahoo.com/v1/test/getcrumb")
            if r.status_code == 200 and r.text and "<" not in r.text and len(r.text) < 64:
                self.crumb = r.text.strip()
        except httpx.HTTPError:
            pass

    def fetch(self, ticker: str, today: date):
        self._session()
        start = datetime.combine(today - timedelta(days=5 * 366 + 14), datetime.min.time(), tzinfo=timezone.utc)
        params = {
            "period1": int(start.timestamp()),
            "period2": int(datetime.now(timezone.utc).timestamp()),
            "interval": "1d",
            "events": "split",
            "includePrePost": "false",
        }
        if self.crumb:
            params["crumb"] = self.crumb
        for attempt in range(3):
            response = self.client.get(YAHOO.format(symbol=ticker), params=params)
            if response.status_code != 429:
                break
            time.sleep(2 * (attempt + 1))
        response.raise_for_status()
        return parse_yahoo(response.json(), today)


def parse_nasdaq(payload: dict, today: date):
    """Nasdaq 歷史行情 JSON（金額為 "$1,234.56" 字串、日期 MM/DD/YYYY）→ summarize()。"""
    rows = (((payload or {}).get("data") or {}).get("tradesTable") or {}).get("rows") or []
    if not rows:
        raise ValueError("nasdaq payload has no rows")
    money = lambda v: float(str(v).replace("$", "").replace(",", "").strip())  # noqa: E731
    bars = []
    for r in rows:
        m, d, y = (int(x) for x in r["date"].split("/"))
        bars.append((date(y, m, d), money(r["high"]), money(r["low"]), money(r["close"])))
    return summarize(bars, today)


def split_adjust(bars, splits):
    """若日線在已知分割日前後出現與分割比例相符的跳空（未調整），把分割前的價格除以比例。

    已調整的資料不會有這種跳空，維持原值；判斷不出來（缺資料）時也不改。
    """
    bars = sorted(bars)
    for s in splits or []:
        d = date.fromisoformat(s["date"])
        before = [b for b in bars if b[0] < d]
        after = [b for b in bars if b[0] >= d]
        if not before or not after:
            continue
        jump = before[-1][3] / after[0][3]
        if abs(jump / s["ratio"] - 1) < 0.35:
            r = s["ratio"]
            bars = [(b[0], b[1] / r, b[2] / r, b[3] / r) if b[0] < d else b for b in bars]
    return bars


def parse_cboe(payload: dict, today: date, splits=None):
    """Cboe 歷史日線 JSON（data: [{date, high, low, close}]）→ summarize()。"""
    rows = (payload or {}).get("data") or []
    if not rows:
        raise ValueError("cboe payload has no rows")
    start = today - timedelta(days=5 * 366 + 14)
    bars = []
    for r in rows:
        d = date.fromisoformat(str(r["date"])[:10])
        if d < start:
            continue
        hi, lo, close = float(r["high"]), float(r["low"]), float(r["close"])
        if close <= 0:
            continue
        bars.append((d, max(hi, close), min(lo, close) if lo > 0 else close, close))
    return summarize(split_adjust(bars, splits), today)


def fetch_cboe(ticker: str, client: httpx.Client, today: date):
    response = client.get(CBOE.format(symbol=ticker))
    response.raise_for_status()
    return parse_cboe(response.json(), today, KNOWN_SPLITS.get(ticker))


def fetch_nasdaq(ticker: str, client: httpx.Client, today: date):
    for asset in ("stocks", "etf"):
        response = client.get(
            NASDAQ.format(symbol=ticker),
            params={
                "assetclass": asset,
                "fromdate": (today - timedelta(days=5 * 366 + 14)).isoformat(),
                "todate": today.isoformat(),
                "limit": 9999,
            },
            headers={
                "Origin": "https://www.nasdaq.com",
                "Referer": "https://www.nasdaq.com/",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=httpx.Timeout(8, connect=5),
        )
        response.raise_for_status()
        payload = response.json()
        if (payload.get("data") or {}).get("tradesTable"):
            return parse_nasdaq(payload, today)
    raise ValueError("nasdaq: symbol not found")


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


def fetch(ticker: str, client: httpx.Client, today: date, yahoo: "Yahoo | None" = None):
    """依序嘗試各來源，回傳 (來源代號, 資料)；全部失敗丟出所有錯誤。"""
    yahoo = yahoo or Yahoo(client)
    errors = []
    for name, fn in (
        ("yahoo", lambda: yahoo.fetch(ticker, today)),
        ("cboe", lambda: fetch_cboe(ticker, client, today)),
        ("nasdaq", lambda: fetch_nasdaq(ticker, client, today)),
        ("stooq", lambda: fetch_stooq(ticker, client, today)),
    ):
        try:
            return name, fn()
        except Exception as exc:  # noqa: BLE001 - 換下一個來源
            errors.append(f"{name}: {type(exc).__name__}: {str(exc)[:120]}")
    raise RuntimeError("; ".join(errors))


def parse_fred(text: str, today: date):
    """FRED CSV（observation_date,SERIES；缺值為 "."）→ 最新匯率與近 5 年週資料。"""
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2 or len(rows[0]) != 2 or not rows[0][0].lower().endswith("date"):
        raise ValueError(f"unexpected FRED response: {text[:80]!r}")
    points = []
    for d, v in rows[1:]:
        if v.strip() in {"", "."}:
            continue
        rate = float(v)
        if not 1 < rate < 100:
            raise ValueError(f"implausible USD/TWD rate {rate} on {d}")
        points.append((date.fromisoformat(d), rate))
    if not points:
        raise ValueError("FRED series has no values")
    points.sort()
    last = points[-1]
    if (today - last[0]).days > 21:
        raise ValueError(f"stale FX data, last {last[0]}")
    weekly = {}
    for d, r in points:
        if d > last[0] - timedelta(days=5 * 366):
            weekly[d.isocalendar()[:2]] = (d.isoformat(), r)
    return {"asof": last[0].isoformat(), "rate": last[1], "weekly": [list(v) for v in sorted(weekly.values())]}


def fetch_fx(client: httpx.Client, today: date):
    """新臺幣兌美元：Federal Reserve H.10（FRED DEXTAWUS，每 1 美元兌新臺幣，紐約中午買入匯率）。"""
    response = client.get(FRED, params={"id": "DEXTAWUS", "cosd": (today - timedelta(days=5 * 366 + 14)).isoformat()})
    response.raise_for_status()
    out = parse_fred(response.text, today)
    out["source"] = "Federal Reserve H.10（FRED DEXTAWUS）"
    out["unit"] = "TWD per USD"
    return out


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
        yahoo = Yahoo(client)
        for i, t in enumerate(targets):
            if i:
                time.sleep(0.8)  # 放慢速度，避免被限流
            try:
                source, new = fetch(t, client, today, yahoo)
            except Exception as exc:  # noqa: BLE001 - 單檔失敗保留舊值
                failed.append(t)
                print(f"::warning::{t} price update failed; previous price kept: {exc}", file=sys.stderr, flush=True)
                continue
            prev = tickers.get(t)
            if prev and abs(new["close"] / prev["close"] - 1) > 0.5 and not any(
                s["date"] > prev["asof"] for s in new.get("splits") or []
            ):
                print(f"::warning::{t} moved more than 50% since {prev['asof']} (split?) — please review", file=sys.stderr)
            # Yahoo 的分割事件 + 已核對的歷史分割；其他來源沒有分割事件時沿用上次。
            new["splits"] = merge_splits(
                new.get("splits") or (prev or {}).get("splits"), KNOWN_SPLITS.get(t)
            )
            new["source"] = SOURCES[source]
            used.add(SOURCES[source])
            tickers[t] = new
            print(f"{t}: {new['close']} @ {new['asof']} ({SOURCES[source]})", flush=True)
        fx = dict(old.get("fx", {}))
        if not args.ticker:
            try:
                fx["USDTWD"] = fetch_fx(client, today)
                print(f"USDTWD: {fx['USDTWD']['rate']} @ {fx['USDTWD']['asof']}", flush=True)
            except Exception as exc:  # noqa: BLE001 - 匯率失敗保留上次
                print(f"::warning::USD/TWD update failed; previous rate kept: {exc}", file=sys.stderr, flush=True)
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
        "fx": fx,
    }
    args.output.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
