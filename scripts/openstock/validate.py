import json
from pathlib import Path
import re
import sys
from .models import Dataset

# 會被前端放進 <a href> 的欄位：帶協定的值只允許 https，擋掉 javascript:、data:、http: 等。
LINK_KEYS = re.compile(r"(^|_)(url|urls|source|sources|src|link|href)$")
SCHEME = re.compile(r"^\s*[A-Za-z][A-Za-z0-9+.\-]*:")


def check_links(node, path="$"):
    """遞迴檢查 JSON；連結欄位的值若帶協定，必須是 https://。回傳違規清單。"""
    bad = []
    if isinstance(node, dict):
        for key, value in node.items():
            here = f"{path}.{key}"
            if LINK_KEYS.search(key):
                for item in value if isinstance(value, list) else [value]:
                    if isinstance(item, str) and SCHEME.match(item) and not item.strip().startswith("https://"):
                        bad.append(f"{here}: {item[:80]}")
            bad += check_links(value, here)
    elif isinstance(node, list):
        for i, value in enumerate(node):
            bad += check_links(value, f"{path}[{i}]")
    return bad


def validate(directory):
    catalog = json.loads((directory / "catalog.json").read_text())
    if catalog["version"] != 1:
        raise ValueError("unsupported catalog version")
    seen = set()
    count = 0
    for company in catalog["companies"]:
        ticker = company["ticker"]
        if ticker in seen:
            raise ValueError("duplicate ticker")
        seen.add(ticker)
        if company["status"] != "available":
            if company.get("file") is not None:
                raise ValueError("unavailable company must not have a published dataset")
            continue
        if company["file"] != f"{ticker}.json" or not ticker.isalpha() or ticker != ticker.upper():
            raise ValueError("invalid file path")
        d = Dataset.model_validate_json((directory / company["file"]).read_text())
        if d.ticker != ticker or d.cik != company["cik"] or not d.facts:
            raise ValueError("company identity or empty facts mismatch")
        count += 1
    bad = []
    for file in sorted(directory.glob("*.json")):
        bad += [f"{file.name} {b}" for b in check_links(json.loads(file.read_text(encoding="utf-8")))]
    if bad:
        raise ValueError("non-https link in published data:\n" + "\n".join(bad[:20]))
    print(f"Catalog validated: {count} available datasets, {len(seen)-count} unavailable (not financial validation)")


if __name__ == "__main__":
    validate(Path(sys.argv[1] if len(sys.argv) > 1 else "public/data"))
