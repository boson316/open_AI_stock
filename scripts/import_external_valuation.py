"""把使用者提供的季末估值資料（pe_history.json）轉成站內檔案 public/data/external-valuation.json。

這不是 SEC 官方資料：價格與價格帶來自使用者提供的外部來源，僅供研究參照，
不納入 coverage 核對；每個點保留原始欄位，缺值維持 null，不補零。
用法：python scripts/import_external_valuation.py <pe_history.json> [as_of]
"""
import calendar
import json
import sys
from pathlib import Path


def month_end(label):
    yy, mm = label.split("/")
    year, month = 2000 + int(yy), int(mm)
    return f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"


def convert(rows, as_of):
    companies = {}
    for r in rows:
        date = as_of if r["is_now"] else month_end(r["label"])
        bands = [r.get(k) for k in ("p10", "p30", "p50", "p70", "p90")]
        companies.setdefault(r["ticker"], []).append({
            "date": date, "label": "最新" if r["is_now"] else r["label"],
            "price": r["price"], "eps_q": r.get("eps_q"), "eps_ttm": r.get("eps_ttm"),
            "pe": r.get("pe"), "bands": None if any(b is None for b in bands) else bands,
        })
    for v in companies.values():
        v.sort(key=lambda x: x["date"])
    # TSM 來源列中季度 EPS 為新臺幣普通股，其餘為美元 ADR；混用口徑的欄位不保留。
    for r in companies.get("TSM", []):
        r["eps_q"] = None
    return companies


if __name__ == "__main__":
    src = Path(sys.argv[1])
    as_of = sys.argv[2] if len(sys.argv) > 2 else "2026-10-14"
    out = {
        "version": 1, "as_of": as_of, "kind": "user_provided_external",
        "note": "使用者提供的外部估值資料（季末收盤價、EPS、本益比與歷史本益比分位價格帶），非 SEC 官方資料，未逐筆向交易所核對；日期為季末月份最後一日。",
        "basis": {"TSM": "價格、TTM EPS、本益比與價格帶皆為每 ADR 美元（1 ADR = 5 股普通股），與本站官方新臺幣普通股 EPS 不同；來源的季度 EPS 欄為新臺幣普通股、與其餘欄位口徑不同，已移除不用。"},
        "companies": convert(json.loads(src.read_text(encoding="utf-8")), as_of),
    }
    dest = Path("public/data/external-valuation.json")
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{dest}: {len(out['companies'])} companies")
