import json
from datetime import date
from pathlib import Path

from openstock.balance_extra import align_cover_shares, derive_liabilities
from openstock.models import Fact
from openstock.tsm_balance import parse_balance


def f(metric, value, end, acc="a1", tag="us-gaap:X", start=None, filed="2026-10-30"):
    return Fact(metric=metric, value=value, unit="shares" if "shares" in metric else "USD", start=start, end=end,
                filed=filed, accession=acc, tag=tag, source="https://www.sec.gov/x", form="10-Q")


def test_liabilities_derived_only_when_missing_and_keeps_operands():
    facts = [f("liabilities_and_equity", 1000, "2026-09-30", tag="us-gaap:LiabilitiesAndStockholdersEquity"),
             f("equity", 400, "2026-09-30", tag="us-gaap:StockholdersEquity"),
             f("minority_interest", 50, "2026-09-30", tag="us-gaap:MinorityInterest"),
             f("liabilities_and_equity", 900, "2026-06-30", acc="a0"), f("equity", 300, "2026-06-30", acc="a0"),
             f("liabilities", 600, "2026-06-30", acc="a0")]
    out = [x for x in derive_liabilities(facts) if x.metric == "liabilities"]
    derived = [x for x in out if x.quality == "derived"]
    assert len(derived) == 1 and derived[0].value == 550 and derived[0].end == date(2026, 9, 30)
    assert any("MinorityInterest" in line for line in derived[0].lineage)
    # 已有官方總負債的期間不重複推算
    assert [x.value for x in out if x.end == date(2026, 6, 30)] == [600]


def test_cover_shares_align_to_balance_sheet_date_of_same_filing():
    facts = [f("assets", 1, "2026-09-30"), f("shares_cover", 2_400_000_000, "2026-10-21", tag="dei:EntityCommonStockSharesOutstanding"),
             f("shares_cover", 5, "2026-10-21", acc="orphan")]
    out = [x for x in align_cover_shares(facts) if x.metric == "shares_cover"]
    assert len(out) == 1 and out[0].end == date(2026, 9, 30) and "2026-10-21" in out[0].lineage[-1]


def test_tsm_balance_sheet_from_official_consolidated_report():
    docs = json.loads(Path("handoff/reference/official-source-table-inspection.json").read_text())["documents"]
    doc = next(d for d in docs if d.get("source", "").endswith("a2026q2consolidatedreport-.htm"))
    facts = {(x.metric, str(x.end)): x.value for x in parse_balance(doc)}
    assert facts[("assets", "2026-06-30")] == 9_375_654_727_000
    assert facts[("liabilities", "2026-06-30")] == 2_901_183_746_000
    assert facts[("equity", "2026-06-30")] == 6_432_518_334_000
    assert facts[("cash", "2025-12-31")] == 2_767_856_402_000
    assert facts[("shares", "2026-06-30")] == 25_932_370_100
    assert facts[("long_term_debt", "2026-06-30")] == (815_036_716 + 49_226_958) * 1000
    # 權益 + 負債 + 非控制權益 = 總資產
    assert facts[("assets", "2026-06-30")] == facts[("liabilities", "2026-06-30")] + facts[("equity", "2026-06-30")] + 41_952_647_000


def test_tsm_parent_only_report_is_ignored():
    docs = json.loads(Path("handoff/reference/official-source-table-inspection.json").read_text())["documents"]
    doc = next(d for d in docs if "standalone" in d.get("source", "") or "unconsolidated" in d.get("source", ""))
    assert parse_balance(doc) == []
