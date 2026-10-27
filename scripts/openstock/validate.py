import json
from pathlib import Path
import sys
from .models import Dataset


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
    print(f"Catalog validated: {count} available datasets, {len(seen)-count} unavailable (not financial validation)")


if __name__ == "__main__":
    validate(Path(sys.argv[1] if len(sys.argv) > 1 else "public/data"))
