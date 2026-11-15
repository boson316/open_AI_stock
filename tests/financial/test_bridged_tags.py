"""Synthetic tests for reviewed tag migrations (BRIDGED); never published as financial observations."""
import pytest
from openstock.mapping import extract
from openstock.normalize import quarters

SOFI = "0001818874"
OLD, NEW = "PaymentsToAcquireProductiveAssets", "PaymentsToAcquirePropertyPlantAndEquipment"
TAGS = {"capex": [f"us-gaap:{OLD}", f"us-gaap:{NEW}"]}


def row(start, end, val, filed, accn, fy):
    return {"start": start, "end": end, "val": val, "filed": filed, "accn": accn, "form": "10-Q", "fy": fy}


def companyfacts(overlap_value=176):
    old = [row("2025-01-01", "2025-09-30", 176, "2025-11-06", "a-25q3", 2025),
           row("2026-01-01", "2026-03-31", 67, "2026-05-07", "a-26q1", 2026),
           row("2026-01-01", "2026-06-30", 164, "2026-08-06", "a-26q2", 2026)]
    new = [row("2025-01-01", "2025-09-30", overlap_value, "2026-11-05", "a-26q3", 2026),
           row("2026-01-01", "2026-09-30", 265, "2026-11-05", "a-26q3", 2026)]
    return {"cik": int(SOFI), "facts": {"us-gaap": {OLD: {"units": {"USD": old}}, NEW: {"units": {"USD": new}}}}}


def capex(facts):
    return {str(f.end): f for f in quarters([f for f in facts if f.metric == "capex"])}


def test_retagged_capex_is_bridged_and_third_quarter_is_derived():
    q = capex(extract(companyfacts(), SOFI, TAGS))
    third = q["2026-09-30"]
    assert third.value == 265 - 164 and third.quality == "derived"
    assert "reviewed equivalent tags" in third.lineage[0]
    assert OLD in third.lineage[2] and NEW in third.lineage[1]


def test_conflicting_overlap_requires_review():
    with pytest.raises(ValueError, match="concept migration requires review"):
        extract(companyfacts(overlap_value=999), SOFI, TAGS)


def test_other_companies_keep_single_concept():
    facts = extract(companyfacts(), "0000000001", TAGS)
    assert {f.tag for f in facts if f.metric == "capex"} == {f"us-gaap:{NEW}"}
    assert "2026-09-30" not in capex(facts)
