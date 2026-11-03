import hashlib

import pytest

from openstock import nvidia_cash
from openstock.nvidia_cash import DOCUMENTS, reviewed_facts, row_still_present

ROWS = DOCUMENTS[0][6]  # 1833, 976, 1128


def page(values):
    cells = "".join(f'<td>(</td><td>{v}</td><td>)</td>' for v in values)
    return f'<table><tr><td>Purchases related to property and equipment and intangible&#160;assets</td>{cells}</tr></table>'.encode()


def test_row_present_after_rerender():
    assert row_still_present(page(["1,833", "976", "1,128"]), ROWS)


def test_row_rejects_changed_value_or_partial_match():
    assert not row_still_present(page(["1,833", "1,976", "1,128"]), ROWS)
    assert not row_still_present(page(["1,833", "977", "1,128"]), ROWS)
    assert not row_still_present(b"<p>unrelated</p>", ROWS)


class FakeClient:
    def __init__(self, body):
        self.body = body

    def get_bytes(self, url):
        return self.body


def test_checksum_change_with_same_values_continues(monkeypatch):
    body = page(["1,833", "976", "1,128"])
    monkeypatch.setattr(nvidia_cash, "DOCUMENTS", [DOCUMENTS[0]])
    facts = reviewed_facts(FakeClient(body))
    assert [f.value for f in facts] == [1833e6, 976e6, 1128e6]
    assert hashlib.sha256(body).hexdigest() in facts[0].lineage[-1]


def test_checksum_change_with_missing_values_fails(monkeypatch):
    monkeypatch.setattr(nvidia_cash, "DOCUMENTS", [DOCUMENTS[0]])
    with pytest.raises(ValueError, match="review required"):
        reviewed_facts(FakeClient(b"<p>changed</p>"))
