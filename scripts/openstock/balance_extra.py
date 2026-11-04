"""資產負債表補充：封面流通股數對齊財報期末、缺漏的總負債以官方合計推算。

- 封面股數（dei:EntityCommonStockSharesOutstanding）的日期是封面日（通常在期末後數週）。
  這裡把 end 改成同一份申報的資產負債表期末，lineage 保留實際封面日，前端才能與同期權益配對。
- 總負債（us-gaap:Liabilities）有些公司不標註（例如 Amazon、AMD）。改以同一份申報、同一期末的
  「負債及權益總計 − 股東權益 − 非控制權益」推算，標記 derived 並保存兩個來源數字；
  權益若採含非控制權益的標籤，不再另減。缺任何一項就不推算。
"""
from .models import Fact


def align_cover_shares(facts: list[Fact]) -> list[Fact]:
    period_end = {}
    for f in facts:
        if f.metric == "assets" and f.start is None:
            period_end[f.accession] = max(period_end.get(f.accession, f.end), f.end)
    out, seen = [], {}
    for f in facts:
        if f.metric != "shares_cover":
            out.append(f)
            continue
        end = period_end.get(f.accession)
        if end is None or f.end < end:
            continue  # 找不到同申報的資產負債表期末：不猜測
        if f.accession in seen:
            if seen[f.accession].value != f.value:
                # 同一申報出現多筆封面股數（多類股或多個封面日），無法確定合計口徑，全部捨棄。
                seen[f.accession] = None
            continue
        seen[f.accession] = f.model_copy(update={
            "end": end,
            "lineage": [*f.lineage, f"Cover-page shares outstanding as of {f.end}; aligned to balance-sheet date {end} of the same filing"],
        })
    out.extend(v for v in seen.values() if v is not None)
    return out


def derive_liabilities(facts: list[Fact]) -> list[Fact]:
    def index(metric):
        d = {}
        for f in facts:
            if f.metric == metric and f.start is None:
                d.setdefault((f.end, f.accession), []).append(f)
        return d

    total, equity, nci, liab = index("liabilities_and_equity"), index("equity"), index("minority_interest"), index("liabilities")
    derived = []
    for key, rows in total.items():
        if key in liab or key not in equity:
            continue
        t, e = rows[0], equity[key][0]
        if len({r.value for r in rows}) != 1 or len({r.value for r in equity[key]}) != 1:
            continue
        includes_nci = e.tag.endswith("IncludingPortionAttributableToNoncontrollingInterest")
        minority = 0.0
        if not includes_nci and key in nci:
            minority = nci[key][0].value
        value = t.value - e.value - minority
        if value < 0:
            continue
        lineage = [f"{t.tag}: {t.value}", f"minus {e.tag}: {e.value}"]
        if minority:
            lineage.append(f"minus us-gaap:MinorityInterest: {minority}")
        lineage.append("Total liabilities derived from same filing and balance-sheet date; issuer does not tag us-gaap:Liabilities")
        derived.append(Fact(metric="liabilities", value=value, unit=t.unit, start=None, end=t.end, filed=max(t.filed, e.filed),
            accession=t.accession, tag="calculated:liabilities-and-equity-minus-equity", report_fiscal_year=t.report_fiscal_year,
            reporting_basis=t.reporting_basis, source=t.source, source_refs=list(dict.fromkeys([t.source, e.source])),
            form=t.form, quality="derived", lineage=lineage))
    return facts + derived
