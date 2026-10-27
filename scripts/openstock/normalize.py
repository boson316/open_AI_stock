"""Conservative quarter derivation with period and filing compatibility.

Use an as-of date for historical availability. Prefer directly reported 3-month
facts. Never subtract EPS or share counts: weighted denominators are not additive.
Use only operands disclosed together in the same accession/tag/unit/YTD start;
otherwise return missing rather than mix restatement versions.
"""
from datetime import timedelta, date
from .models import Fact
from .mapping import INSTANT


def days(f):
    return (f.end - f.start).days + 1 if f.start else 0


def quarters(facts: list[Fact], as_of: date | None = None) -> list[Fact]:
    available = [f for f in facts if as_of is None or f.filed <= as_of]
    groups = {}
    def group_key(f):
        return (f.metric, f.tag, f.unit, f.start, f.accession)
    for f in available:
        groups.setdefault(group_key(f), []).append(f)
    selected = {}
    for f in available:
        if f.metric in INSTANT or 70 <= days(f) <= 105:
            key = (f.metric, f.end, f.unit)
            old = selected.get(key)
            if old is None or (f.filed, f.accession) > (old.filed, old.accession):
                selected[key] = f
    for f in available:
        if f.metric in INSTANT or f.metric in {"eps", "nim"} or not 150 <= days(f) <= 380:
            continue
        prior = [p for p in groups[group_key(f)] if 70 <= (f.end - p.end).days <= 105]
        if not prior:
            continue
        p = max(prior, key=lambda x: x.end)
        key = (f.metric, f.end, f.unit)
        old = selected.get(key)
        # Prefer direct disclosure for the same filing vintage.
        if old and old.filed >= f.filed:
            continue
        selected[key] = f.model_copy(update={
            "value": f.value - p.value, "start": p.end + timedelta(days=1), "quality": "derived",
            "lineage": [f"{f.tag}|{f.accession}|{f.start}|{f.end}|{f.value}",
                        f"minus {p.tag}|{p.accession}|{p.start}|{p.end}|{p.value}"]})
    return sorted(selected.values(), key=lambda f: (f.end, f.metric))
