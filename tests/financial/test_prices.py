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
