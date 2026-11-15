import json
from pathlib import Path

from openstock.validate import check_links


def test_link_fields_reject_non_https_schemes():
    data = {"a": [{"url": "javascript:alert(1)"}, {"tw_src": "http://x.example"}, {"source": "Cboe"}, {"source": "https://ok.example"}]}
    assert check_links(data) == ["$.a[0].url: javascript:alert(1)", "$.a[1].tw_src: http://x.example"]


def test_published_data_links_are_https():
    for file in sorted(Path("public/data").glob("*.json")):
        assert check_links(json.loads(file.read_text(encoding="utf-8"))) == [], file.name
