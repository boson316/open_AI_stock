import json
from datetime import date
from pathlib import Path

import pytest

from openstock.prices import parse

CSV = "Date,Open,High,Low,Close,Volume\n" + "\n".join(
    f"2026-{m:02d}-{d:02d},10,{12 + m},{8 - m * 0.1:.1f},{10 + m},100" for m in range(1, 11) for d in (5, 20)
)


def test_parse_close_and_52w_range():
    r = parse(CSV, date(2026, 10, 25))
    assert r["asof"] == "2026-10-20" and r["close"] == 20
    assert r["hi52"] == 22 and r["lo52"] == 7.0
    assert r["weekly"][-1] == ["2026-10-20", 20.0]


def test_rejects_stale_or_garbage():
    with pytest.raises(ValueError, match="stale"):
        parse(CSV, date(2026, 12, 31))
    with pytest.raises(ValueError):
        parse("Exceeded the daily hits limit", date(2026, 10, 25))
    with pytest.raises(ValueError):
        parse("Date,Open,High,Low,Close,Volume\n2026-10-20,10,9,8,10,1", date(2026, 10, 25))


def test_published_prices_are_consistent():
    path = Path("public/data/prices.json")
    if not path.exists():
        pytest.skip("prices.json not generated yet")
    data = json.loads(path.read_text())
    assert data["version"] == 1
    for t, p in data["tickers"].items():
        assert p["lo52"] <= p["close"] <= p["hi52"], t


def _yahoo(days, splits=None, offset=-14400):
    base = 1761000000  # 2025-10-20 22:40 UTC
    stamps = [base + i * 86400 for i in range(days)]
    return {
        "chart": {
            "result": [
                {
                    "meta": {"gmtoffset": offset},
                    "timestamp": stamps,
                    "events": {"splits": splits or {}},
                    "indicators": {
                        "quote": [
                            {
                                "high": [11 + i * 0.1 for i in range(days)],
                                "low": [9 + i * 0.1 for i in range(days)],
                                "close": [10 + i * 0.1 if i != 3 else None for i in range(days)],
                            }
                        ]
                    },
                }
            ],
            "error": None,
        }
    }


def test_parse_yahoo_uses_exchange_dates_and_skips_gaps():
    from openstock.prices import parse_yahoo

    payload = _yahoo(10, {"x": {"date": 1761000000, "numerator": 10, "denominator": 1}})
    r = parse_yahoo(payload, date(2025, 11, 1))
    # 22:40 UTC − 4h = 當地 18:40，日期仍是 10/20（週一）；週線保留該 ISO 週最後一天 10/26
    assert r["weekly"][0][0] == "2025-10-26"
    assert r["asof"] == "2025-10-29" and r["close"] == pytest.approx(10.9)
    assert r["prev_close"] == pytest.approx(10.8)
    assert r["lo52"] == 9 and r["hi52"] == pytest.approx(11.9)
    assert r["splits"] == [{"date": "2025-10-20", "ratio": 10.0}]


def test_parse_yahoo_rejects_errors_and_stale():
    from openstock.prices import parse_yahoo

    with pytest.raises(ValueError):
        parse_yahoo({"chart": {"result": None, "error": {"code": "Not Found"}}}, date(2025, 11, 1))
    with pytest.raises(ValueError, match="stale"):
        parse_yahoo(_yahoo(5), date(2026, 3, 1))


def test_published_prices_have_sorted_weekly_and_valid_splits():
    path = Path("public/data/prices.json")
    if not path.exists():
        pytest.skip("prices.json not generated yet")
    data = json.loads(path.read_text())
    for t, p in data["tickers"].items():
        dates = [d for d, _ in p["weekly"]]
        assert dates == sorted(dates) and len(set(dates)) == len(dates), t
        assert all(c > 0 for _, c in p["weekly"]), t
        assert dates[-1] <= p["asof"], t
        for s in p.get("splits", []):
            assert s["ratio"] > 0 and len(s["date"]) == 10, t


def test_parse_nasdaq_money_strings():
    from openstock.prices import parse_nasdaq

    rows = [
        {"date": "10/30/2025", "close": "$1,010.50", "high": "$1,020.00", "low": "$990.10"},
        {"date": "10/31/2025", "close": "$1,000.00", "high": "$1,011.00", "low": "$995.00"},
    ]
    r = parse_nasdaq({"data": {"tradesTable": {"rows": rows}}}, date(2025, 11, 2))
    assert r["asof"] == "2025-10-31" and r["close"] == 1000 and r["prev_close"] == 1010.5
    assert r["hi52"] == 1020 and r["lo52"] == 990.1
    with pytest.raises(ValueError):
        parse_nasdaq({"data": None}, date(2025, 11, 2))


def test_merge_splits_keeps_known_events_sorted_and_unique():
    from openstock.prices import KNOWN_SPLITS, merge_splits

    merged = merge_splits([{"date": "2024-06-10", "ratio": 10}], KNOWN_SPLITS["NVDA"])
    assert merged == [{"date": "2021-07-20", "ratio": 4.0}, {"date": "2024-06-10", "ratio": 10.0}]


def test_cboe_unadjusted_split_is_detected_and_adjusted():
    from openstock.prices import parse_cboe

    rows = [{"date": "2025-10-%02d" % d, "high": 101, "low": 99, "close": 100} for d in range(1, 10)]
    rows += [{"date": "2025-10-%02d" % d, "high": 10.2, "low": 9.8, "close": 10} for d in range(10, 20)]
    r = parse_cboe({"data": rows}, date(2025, 10, 25), [{"date": "2025-10-10", "ratio": 10.0}])
    assert all(abs(c - 10) < 1e-9 for _, c in r["weekly"])
    assert r["hi52"] == 10.2
    # 已調整的資料（沒有跳空）不改
    flat = [{"date": "2025-10-%02d" % d, "high": 10.2, "low": 9.8, "close": 10} for d in range(1, 20)]
    assert parse_cboe({"data": flat}, date(2025, 10, 25), [{"date": "2025-10-10", "ratio": 10.0}])["close"] == 10


def test_parse_fred_skips_missing_and_rejects_stale():
    from openstock.prices import parse_fred

    text = "observation_date,DEXTAWUS\n2026-10-26,31.50\n2026-10-27,.\n2026-10-28,31.62\n2026-10-30,31.70\n"
    r = parse_fred(text, date(2026, 11, 2))
    assert r["asof"] == "2026-10-30" and r["rate"] == 31.70
    assert r["weekly"] == [["2026-10-30", 31.70]]
    with pytest.raises(ValueError, match="stale"):
        parse_fred(text, date(2027, 1, 30))
    with pytest.raises(ValueError):
        parse_fred("<html>", date(2026, 11, 2))
