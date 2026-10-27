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
    facts = extract(raw, cik, {**COMPANY_MAPPINGS.get(ticker, {}), **(overrides or {})})
    if supplemental:
        if ticker != "SOFI":
            raise ValueError("Supplemental adapter currently supports SOFI only")
        from .supplemental import fetch_releases
        facts += fetch_releases(SECClient())
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
    dataset = Dataset(ticker=ticker, cik=cik, name=name, sector=sector,
        updated=datetime.now(timezone.utc).isoformat(), source=url,
        facts=facts, warnings=[
            "資料採 SEC Company Facts；公司自訂、分部及營運指標未完整涵蓋。",
            "單季累積值僅在相同申報版本、標籤、單位與期間相容時相減；不足時顯示 N/A。",
            "EPS 不做累積值相減；TTM EPS 採四個已公布單季之和，股數變化可能影響可比性。",
            "自訂標籤須透過明確映射及官方 Inline XBRL 匯入；分部及未映射欄位維持缺值。",
            "SoFi 營收採 RevenuesNetOfInterestExpense；排除 2021-06-30 之前 SPAC 期間。",
        ])
    # Preserve raw filing vintages for point-in-time valuation and restatement audit.
    data = dataset.model_dump(mode="json")
    atomic_json(output / f"{ticker}.json", data)
    catalog_path = output / "catalog.json"
    catalog = json.loads(catalog_path.read_text()) if catalog_path.exists() else {"version": 1, "companies": [], "coverage": list(COMPANIES)}
    entry = {"ticker": ticker, "cik": cik, "name": name, "exchange": "NASDAQ" if ticker != "TSM" else "NYSE", "sector": sector,
        "status": "available", "file": f"{ticker}.json", "updated": dataset.updated}
    catalog["companies"] = [c for c in catalog["companies"] if c["ticker"] != ticker] + [entry]
    atomic_json(catalog_path, catalog)
    return dataset


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ticker", choices=COMPANIES, default="SOFI")
    p.add_argument("--output", type=Path, default=Path("public/data"))
    p.add_argument("--input", type=Path, help="An unmodified official SEC Company Facts JSON file")
    p.add_argument("--mapping", type=Path, help="Reviewed metric -> [namespace:tag] JSON override")
    p.add_argument("--supplemental", action="store_true", help="Fetch last 4 official SoFi earnings releases, including direct Q4 EPS")
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
        d = generate(args.ticker, args.output, args.input, json.loads(args.mapping.read_text()) if args.mapping else None, filing, args.supplemental)
        print(f"Validated {d.ticker}: {len(d.facts)} reported facts; catalog published")
    except Exception as exc:
        print(f"Update failed; previous valid data retained: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
