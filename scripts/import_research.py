"""把使用者提供的研究儀表板資料（artifact 匯出的 JSON）轉成 public/data/research.json。

原則：
- 這些是外部資料（stockanalysis.com、Insider Monkey、Multpl、Siblis、新聞等，由使用者整理），
  不是 SEC 官方資料；網站上一律標示來源與截止日。
- 官方已有的欄位（營收、毛利、營業利益、淨利、EPS、現金流）以官方為準：
  這裡只匯入官方沒有的欄位，並逐筆與官方比對、把差異寫進 reconciliation。
- 個人資料（帳戶、持股、成本）不匯入公開網站；「依記憶整理、非精確值」的 2022 跌幅不匯入。
- 單位不明確的欄位（TSM 市值）設為 null，不猜。

用法：.venv/Scripts/python scripts/import_research.py <artifact 資產資料夾>
"""
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from openstock.models import Dataset  # noqa: E402
from openstock.normalize import quarters  # noqa: E402

ASSETS = {
    "companies": "5ebb4a3a41305f3fba3a0a0898948e0b",
    "quarterly": "8faedc250a5d17eb708f3e3a691a71e8",
    "price_levels": "7d2319aae9bd12bd12f6cd5617cd0244",
    "roic_inputs": "03c1b6dc7af916bbd3bd3ee1828bfe72",
    "val_scen": "fbd26b2b910c0c5801bb9a2c27d2ecc1",
    "commentary": "c49344ba7a57a4622514cb6fa25a877b",
    "risk": "e804c6b367d45a34ecb71b8af4a78444",
    "gurus": "5838efdbda60cf77dd25f4cb428c8505",
    "guru_holdings": "a6e2b92ee11f87efd1f6b101d3e14e92",
    "val_metrics": "e77cfda3618bf130e97fa51fe3a62072",
    "val_cape_us": "b178becf370ed973ff8fb4e7980b3075",
    "val_cape_country": "dbf42bfe445b90a72d5bc1137a7af77a",
    "val_yields": "238e0ea758f634a0030a6bbdf4b90da4",
    "macro": "0475898ea8261096a944ccb89429732f",
    "etf": "0ac63bffa504f455b032bd12da23e192",
    "etf_holdings": "51db509f7cd80913d154bcfb23aba3ec",
    "defensive": "da295ed1036dc6606b5b8a4853efffd1",
    "checklist": "1ffe8c5a6dcddcae69baba65621563fb",
}
# 官方欄位對照：外部欄位 → 本站 metric
OFFICIAL = {"revenue": "revenue", "gross": "gross_profit", "op": "operating_income", "ni": "net_income",
            "eps": "eps", "ocf": "ocf", "capex": "capex", "inv": "icf", "fin": "financing_cf"}
# 官方沒有、從外部補充的季度欄位
EXTRA = ["pretax", "acq", "sec", "buyback", "div", "cash", "debt", "net_cash", "roe", "roa", "roic",
         "pe", "pb", "ev_ebitda", "de", "cr", "fcf_yield"]
COMMENTARY_EXCLUDE = {"PORT"}  # 個人部位相關


def load(folder, name):
    return json.loads((folder / f"{ASSETS[name]}.json").read_text(encoding="utf-8"))


def reconcile(quarterly, data_dir):
    checked, mismatches = 0, []
    for ticker in sorted({r["ticker"] for r in quarterly}):
        ds = Dataset.model_validate_json((data_dir / f"{ticker}.json").read_text(encoding="utf-8"))
        official = quarters(ds.facts)
        for r in (x for x in quarterly if x["ticker"] == ticker):
            end = date.fromisoformat(r["q_end"])
            for key, metric in OFFICIAL.items():
                if r.get(key) is None:
                    continue
                match = [f for f in official if f.metric == metric and abs((f.end - end).days) <= 7]
                if not match:
                    continue
                checked += 1
                ours = match[0].value if metric == "eps" else match[0].value / 1e8
                theirs = r[key]
                if metric == "capex":
                    ours, theirs = abs(ours), abs(theirs)
                tol = 0.011 if metric == "eps" else max(0.6, abs(ours) * 0.003)
                if abs(ours - theirs) > tol:
                    mismatches.append({"ticker": ticker, "quarter": r["q"], "end": r["q_end"], "field": metric,
                                       "official": round(ours, 4), "external": theirs,
                                       "unit": "每股" if metric == "eps" else ("億新臺幣" if ticker == "TSM" else "億美元")})
    return {"checked": checked, "matched": checked - len(mismatches), "mismatches": mismatches,
            "rule": "同季（結帳日相差 ≤ 7 天）逐欄比對；金額容差 max(0.6 億, 0.3%)，EPS 容差 0.011。不一致時網站一律採官方 SEC 值。"}


def build(folder, data_dir):
    companies = load(folder, "companies")
    levels = {r["ticker"]: r for r in load(folder, "price_levels")}
    quarterly = load(folder, "quarterly")
    yields = load(folder, "val_yields")
    rf = next(r["us"] for r in yields if r["id"] == "bond10")
    out = {
        "version": 1,
        "as_of": "2026-10-15",
        "kind": "user_provided_external",
        "note": "使用者提供的研究資料整理（stockanalysis.com／S&P Global Market Intelligence、Insider Monkey、InsiderSet、Valuesider、Multpl、Siblis Research 與新聞），2026-10-15 前後擷取；非 SEC 官方資料。與官方重疊的財報欄位以官方為準，差異見 reconciliation。",
        "companies": {},
        "quarterly": {},
        "roic": {},
        "rf_us10y": rf,
        "scenarios": {},
        "risk": {},
        "commentary": {},
    }
    for c in companies:
        t = c["ticker"]
        lv = levels.get(t, {})
        out["companies"][t] = {
            "name_zh": c["name_zh"], "latest_q": c["latest_q"],
            "price": c["price"], "price_asof": c["price_asof"],
            "close": lv.get("close"), "close_asof": "2026-10-14 收盤", "hi52": lv.get("hi52"), "lo52": lv.get("lo52"),
            "pe": c["pe"], "fwd_pe": c["fwd_pe"], "pb": c["pb"], "ps": c["ps"], "pfcf": c["pfcf"],
            # TSM 市值單位在來源中自相矛盾（標示億新台幣、數量級為美元），不顯示。
            "mcap_100m_usd": None if t == "TSM" else c["mcap"],
            "pe_n": c["pe_n"], "pe_min": c["pe_min"], "pe_max": c["pe_max"], "pe_median": c["pe_median"],
            "pe_rank": c["pe_rank"],
            "basis": "股價、本益比為美元 ADR（1 ADR = 5 股普通股）；財報為新臺幣" if t == "TSM" else None,
        }
    for r in sorted(quarterly, key=lambda x: (x["ticker"], x["q_end"])):
        out["quarterly"].setdefault(r["ticker"], []).append(
            {"quarter": r["q"], "end": r["q_end"], **{k: r.get(k) for k in EXTRA}})
    raw_mcap = {c["ticker"]: c["mcap"] for c in companies}
    for r in load(folder, "roic_inputs"):
        t = r["ticker"]
        rows = sorted((x for x in quarterly if x["ticker"] == t), key=lambda x: x["q_end"])
        debt_usd = rows[-1]["debt"] / r["fx_to_usd"]
        # 債務占資本 = 最新季總債務 ÷（市值 + 總債務），皆換成億美元。TSM 市值單位在來源中標示不一致，
        # 依數量級視為億美元（ADR 計價）；TSM 債務占比不到 2%，對 WACC 影響 < 0.1 個百分點。
        weight = debt_usd / (raw_mcap[t] + debt_usd)
        out["roic"][t] = {**{k: r[k] for k in ("beta", "beta_src", "beta_asof", "erp", "kd_spread", "tax", "note")},
                          "debt_weight": round(weight, 4),
                          "roic_latest": rows[-1]["roic"], "roic_avg4": round(sum(x["roic"] for x in rows) / len(rows), 2),
                          "roic_quarter": rows[-1]["q"],
                          "debt_weight_note": "TSM 市值單位來源標示不一致，依數量級視為億美元；債務占比 < 2%，影響極小。" if t == "TSM" else None}
    for r in sorted(load(folder, "val_scen"), key=lambda x: (x["ticker"], x["order"])):
        out["scenarios"].setdefault(r["ticker"], []).append(
            {k: r[k] for k in ("scenario", "label", "eps_cagr", "exit_pe", "years", "hurdle", "prem", "basis")})
    for r in load(folder, "risk"):
        out["risk"][r["ticker"]] = {k: r[k] for k in ("label", "group", "rate_risk", "ai_exposure", "buffer")}
    for r in sorted(load(folder, "commentary"), key=lambda x: (x["ticker"], x["kind"], x["n"])):
        if r["ticker"] in COMMENTARY_EXCLUDE:
            continue
        # 依記憶整理的 2022 跌幅不收錄
        if r["ticker"] == "RISK" and "2022" in r["text"]:
            continue
        out["commentary"].setdefault(r["ticker"], []).append({"kind": r["kind"], "text": r["text"]})
    out["gurus"] = [{k: g[k] for k in ("id", "name", "fund", "quarter", "aum_b", "style", "url", "note")}
                    for g in sorted(load(folder, "gurus"), key=lambda x: x["order"])]
    out["guru_holdings"] = [{k: h[k] for k in ("manager", "ticker", "name", "weight", "chg", "action", "option", "note")}
                            for h in load(folder, "guru_holdings")]
    out["market"] = {
        "metrics": sorted(load(folder, "val_metrics"), key=lambda x: x["order"]),
        "cape_us": load(folder, "val_cape_us"),
        "cape_country": sorted(load(folder, "val_cape_country"), key=lambda x: x["order"]),
        "yields": sorted(yields, key=lambda x: x["order"]),
        "macro": sorted(load(folder, "macro"), key=lambda x: x["order"]),
    }
    out["etf"] = load(folder, "etf")
    out["etf_holdings"] = sorted(load(folder, "etf_holdings"), key=lambda x: (x["etf"], x["rank"]))
    for etf in out["etf"]:
        lv = levels.get(etf["ticker"], {})
        etf["close"], etf["hi52"], etf["lo52"] = lv.get("close"), lv.get("hi52"), lv.get("lo52")
    out["defensive"] = sorted(load(folder, "defensive"), key=lambda x: x["order"])
    out["checklist"] = load(folder, "checklist")
    out["reconciliation"] = reconcile(quarterly, data_dir)
    return out


if __name__ == "__main__":
    folder = Path(sys.argv[1])
    data_dir = Path("public/data")
    result = build(folder, data_dir)
    (data_dir / "research.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    r = result["reconciliation"]
    print(f"research.json: {len(result['companies'])} companies; reconciliation {r['matched']}/{r['checked']} matched")
    for m in r["mismatches"]:
        print("  mismatch", m)
