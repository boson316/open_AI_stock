from openstock.mapping import INSTANT, extract
from openstock.normalize import quarters


def row(val, end, start=None, form="10-Q", filed="2026-08-01", accn="0000000001-26-000001", fy=2026):
    r = {"val": val, "end": end, "filed": filed, "accn": accn, "form": form, "fy": fy}
    if start:
        r["start"] = start
    return r


def facts(us):
    return {"facts": {"us-gaap": {k: {"units": v} for k, v in us.items()}}}


def test_balance_extras_are_instant_and_extracted():
    raw = facts({
        "AssetsCurrent": {"USD": [row(500, "2026-06-30")]},
        "LiabilitiesCurrent": {"USD": [row(200, "2026-06-30")]},
        "InventoryNet": {"USD": [row(80, "2026-06-30")]},
        "LongTermDebtNoncurrent": {"USD": [row(300, "2026-06-30")]},
    })
    got = {f.metric: f.value for f in extract(raw, "0000000001")}
    assert got == {"current_assets": 500, "current_liabilities": 200, "inventory": 80, "long_term_debt": 300}
    assert {"current_assets", "inventory", "long_term_debt"} <= INSTANT


def test_dividends_paid_quarter_derived_from_ytd_but_dps_is_not():
    raw = facts({
        "PaymentsOfDividendsCommonStock": {"USD": [
            row(10, "2026-03-31", "2026-01-01", filed="2026-05-01", accn="0000000001-26-000001"),
            row(10, "2026-03-31", "2026-01-01", filed="2026-08-01", accn="0000000001-26-000002"),
            row(25, "2026-06-30", "2026-01-01", filed="2026-08-01", accn="0000000001-26-000002"),
        ]},
        "CommonStockDividendsPerShareDeclared": {"USD/shares": [
            row(0.5, "2026-06-30", "2026-01-01", filed="2026-08-01", accn="0000000001-26-000002"),
        ]},
    })
    q = quarters(extract(raw, "0000000001"))
    paid = {str(f.end): f.value for f in q if f.metric == "dividends_paid"}
    assert paid == {"2026-03-31": 10, "2026-06-30": 15}
    assert not [f for f in q if f.metric == "dps"]  # YTD 每股股利不相減


def test_ifrs_tags_for_tsm():
    raw = {"facts": {"ifrs-full": {
        "CurrentAssets": {"units": {"TWD": [row(9, "2025-12-31", form="20-F", filed="2026-04-01")]}},
        "DividendsPaidClassifiedAsFinancingActivities": {"units": {"TWD": [row(7, "2025-12-31", "2025-01-01", form="20-F", filed="2026-04-01")]}},
    }}}
    got = {f.metric: (f.value, f.unit) for f in extract(raw, "0001046179", currency="TWD", standard="IFRS")}
    assert got == {"current_assets": (9, "TWD"), "dividends_paid": (7, "TWD")}


def test_forward_declared_dividend_is_skipped():
    raw = facts({"CommonStockDividendsPerShareDeclared": {"USD/shares": [
        row(0.075, "2013-04-28", "2013-01-28", filed="2013-03-12", accn="0001045810-13-000109"),
        row(0.075, "2013-01-27", "2012-10-29", filed="2013-03-12", accn="0001045810-13-000109"),
    ]}})
    got = [(str(f.end), f.value) for f in extract(raw, "0001045810")]
    assert got == [("2013-01-27", 0.075)]
