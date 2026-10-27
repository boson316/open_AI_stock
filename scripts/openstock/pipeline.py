"""python -m openstock.pipeline --ticker SOFI [--input official-companyfacts.json]

Atomic per-company publication, then atomic catalog update. Existing valid data
is preserved if fetching, normalizing, or schema validation fails.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from .mapping import extract
from .models import Dataset
from .normalize import quarters
from .sec import SECClient

COMPANIES = {
    "SOFI": ("0001818874", "SoFi Technologies", "fintech"),
    "GOOGL": ("0001652044", "Alphabet", "technology"),
    "GOOG": ("0001652044", "Alphabet", "technology"),
    "NVDA": ("0001045810", "NVIDIA", "semiconductor"),
    "AMD": ("0000002488", "Advanced Micro Devices", "semiconductor"),
    "TSM": ("0001046179", "Taiwan Semiconductor Manufacturing", "semiconductor"),
    "MSFT": ("0000789019", "Microsoft", "technology"),
    "AAPL": ("0000320193", "Apple", "technology"),
    "AMZN": ("0001018724", "Amazon", "technology"),
    "META": ("0001326801", "Meta Platforms", "technology"),
    "PLTR": ("0001321655", "Palantir Technologies", "technology"),
    "MU": ("0000723125", "Micron Technology", "semiconductor"),
    "TSLA": ("0001318605", "Tesla", "automotive"),
}

# Reviewed consolidated revenue concept: customer-contract revenue is only one
# component of SoFi net revenue. Do not use it as total company revenue.
COMPANY_MAPPINGS = {"SOFI": {"revenue": ["us-gaap:RevenuesNetOfInterestExpense"]}}


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    tmp.replace(path)


def generate(ticker, output, input_path=None, overrides=None, filing=None, supplemental=False):
    cik, name, sector = COMPANIES[ticker]
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    raw = json.loads(Path(input_path).read_text()) if input_path else SECClient().get_json(url)
    if int(raw.get("cik", -1)) != int(cik):
        raise ValueError("CIK does not match selected company")
    currency, standard = ("TWD", "IFRS") if ticker == "TSM" else ("USD", "US GAAP")
    facts = extract(raw, cik, {**COMPANY_MAPPINGS.get(ticker, {}), **(overrides or {})}, currency=currency, standard=standard)
    if supplemental:
        if ticker == "SOFI":
            from .supplemental import fetch_releases
        elif ticker == "TSM":
            from .tsm import fetch_releases
        else:
            from .us_quarters import fetch_q4
            fetch_releases = lambda client: fetch_q4(client,cik,facts)
        facts += fetch_releases(SECClient())
        if ticker == "SOFI":
            from .us_quarters import fetch_q4
            facts += fetch_q4(SECClient(),cik,facts)
    if filing:
        from .inline import inline_facts
        content = Path(filing["path"]).read_text() if filing.get("path") else SECClient().get_bytes(filing["source"]).decode("utf-8")
        facts += inline_facts(content, overrides or {}, filed=filing["filed"], accession=filing["accession"],
            source=filing["source"], form=filing["form"], cik=cik)
    if ticker == "SOFI":
        # Pre-combination SPAC periods do not describe today's operating company.
        facts = [f for f in facts if str(f.end) >= "2021-06-30"]
    normalized = quarters(facts)
    if not normalized:
        raise ValueError("No compatible reported financial facts; keeping previous dataset")
    periods = []
    if any(f.start and 70 <= (f.end-f.start).days+1 <= 105 for f in normalized):
        periods.append("quarter")
    if any(f.start and 350 <= (f.end-f.start).days+1 <= 380 for f in facts):
        periods.append("annual")
    if not periods or not any(f.metric == "revenue" for f in facts):
        raise ValueError("No usable financial periods or revenue; not publishing ticker")
    dataset = Dataset(ticker=ticker, cik=cik, name=name, sector=sector, currency=currency,
        accounting_standard=standard, periods=periods,
        updated=datetime.now(timezone.utc).isoformat(), source=url,
        facts=facts, warnings=[
            "資料採 SEC Company Facts；公司自訂、分部及營運指標未完整涵蓋。",
            "單季累積值僅在相同申報版本、標籤、單位與期間相容時相減；不足時顯示 N/A。",
            "EPS 不做累積值相減；TTM EPS 採四個已公布單季之和，股數變化可能影響可比性。",
            "自訂標籤須透過明確映射及官方 Inline XBRL 匯入；分部及未映射欄位維持缺值。",
        ] + (["SoFi 營收採 RevenuesNetOfInterestExpense；排除 2021-06-30 之前 SPAC 期間。"] if ticker == "SOFI" else [])
          + (["TSM 採 IFRS、新臺幣及普通股每股口徑；不可直接與美元 ADR 股價計算 PE/PB。",
              "季度盈餘公告採 TIFRS；20-F 年報採 IFRS (IASB)。兩者部分淨利與 EPS 不同，不能混合還原季度或計算 ROE/ROA。",
              "年度採 Company Facts，季度可透過 --supplemental 解析官方 6-K 盈餘公告；不同指標截至日期可能不同。"] if ticker == "TSM" else [])
          + ["歷史 EPS 保存申報當時或官方比較期披露的每股口徑；未宣稱全系列已統一拆股調整，跨拆股比較須查閱來源。"])
    # Preserve raw filing vintages for point-in-time valuation and restatement audit.
    data = dataset.model_dump(mode="json")
    atomic_json(output / f"{ticker}.json", data)
    catalog_path = output / "catalog.json"
    catalog = json.loads(catalog_path.read_text()) if catalog_path.exists() else {"version": 1, "companies": [], "coverage": list(COMPANIES)}
    entry = {"ticker": ticker, "cik": cik, "name": name, "exchange": "NASDAQ" if ticker != "TSM" else "NYSE", "sector": sector,
        "status": "available", "file": f"{ticker}.json", "updated": dataset.updated,
        "currency": currency, "accounting_standard": standard, "periods": periods}
    catalog["companies"] = [c for c in catalog["companies"] if c["ticker"] != ticker] + [entry]
    catalog["coverage"] = list(COMPANIES)
    atomic_json(catalog_path, catalog)
    return dataset


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ticker", choices=[*COMPANIES,"ALL"], default="SOFI")
    p.add_argument("--output", type=Path, default=Path("public/data"))
    p.add_argument("--input", type=Path, help="An unmodified official SEC Company Facts JSON file")
    p.add_argument("--mapping", type=Path, help="Reviewed metric -> [namespace:tag] JSON override")
    p.add_argument("--supplemental", action="store_true", help="Fetch official SOFI / TSM quarterly releases, including directly disclosed EPS")
    p.add_argument("--filing-url", help="Official SEC Inline XBRL filing URL")
    p.add_argument("--filing-input", type=Path, help="Local copy of that official filing")
    p.add_argument("--filed", help="Verified filing date YYYY-MM-DD")
    p.add_argument("--accession", help="Verified filing accession")
    p.add_argument("--form", default="10-Q", choices=["10-Q", "10-K", "10-Q/A", "10-K/A"])
    args = p.parse_args()
    try:
        filing = None
        if args.filing_url:
            if not args.filed or not args.accession or not args.mapping:
                p.error("--filing-url requires --filed, --accession and reviewed --mapping")
            filing = {"path":args.filing_input, "source":args.filing_url, "filed":args.filed, "accession":args.accession, "form":args.form}
        if args.ticker == "ALL" and (args.input or args.mapping or filing):
            p.error("ALL cannot be combined with per-company input/mapping/filing")
        for ticker in COMPANIES if args.ticker == "ALL" else [args.ticker]:
            d = generate(ticker, args.output, args.input, json.loads(args.mapping.read_text()) if args.mapping else None, filing, args.supplemental)
            print(f"Validated {d.ticker}: {len(d.facts)} reported facts; {d.currency} {d.periods}", flush=True)
    except Exception as exc:
        print(f"Update failed; previous valid data retained: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
