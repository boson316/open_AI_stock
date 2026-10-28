"""Conservative quarter derivation with period and filing compatibility.

Use an as-of date for historical availability. Prefer directly reported 3-month
facts. Never subtract EPS or share counts: weighted denominators are not additive.
General metrics require the same accession/tag/unit/YTD start. Additive cash
flows can also use stable, compatible reporting-vintage cohorts; conflicting
revisions remain missing.
"""
from datetime import timedelta, date
from .models import Fact
from .mapping import INSTANT

CASH_FLOWS = {'ocf','icf','financing_cf','capex','sbc'}


def ytd_stage(f):
    n=days(f)
    return next((q for q,low,high in [(1,70,105),(2,150,210),(3,240,315),(4,350,380)] if low<=n<=high),None)


def cash_quarters(facts):
    """Cross-filing YTD differences only within a stable disclosure cohort.

    fy is the filing's fiscal reporting vintage, not an inferred period year.
    It is insufficient alone: exact fiscal start, concept, unit, accounting
    basis, consecutive YTD stages and stable values within that vintage must
    also agree. Any revised value or amended filing blocks cross-filing use.
    Same-accession derivation remains available independently.
    """
    cohorts={}
    for f in facts:
        if f.metric not in CASH_FLOWS|{'gross_profit'} or f.report_fiscal_year is None or f.start is None or (f.quality!='reported' and f.tag!='calculated:revenue-minus-cost'):continue
        if f.reporting_basis not in {'US GAAP','TIFRS'} or ytd_stage(f) is None:continue
        key=(f.metric,f.tag,f.unit,f.start,f.report_fiscal_year,f.reporting_basis)
        cohorts.setdefault(key,{}).setdefault(f.end,[]).append(f)
    result=[]
    for periods in cohorts.values():
        stable={}
        for end,rows in periods.items():
            if len({r.value for r in rows})!=1 or any(r.form.endswith('/A') for r in rows):continue
            stable[end]=max(rows,key=lambda r:(r.filed,r.accession))
        for f in stable.values():
            stage=ytd_stage(f)
            if stage is None or stage==1:continue
            previous=[p for p in stable.values() if ytd_stage(p)==stage-1 and 70<=(f.end-p.end).days<=105]
            if len(previous)!=1:continue
            p=previous[0]
            if p.accession==f.accession:continue
            result.append(f.model_copy(update={'value':f.value-p.value,'start':p.end+timedelta(days=1),
                'filed':max(f.filed,p.filed),'quality':'derived','source_refs':list(dict.fromkeys([f.source,p.source])),
                'lineage':[f'YTD difference; stable reporting-vintage FY{f.report_fiscal_year}; {f.reporting_basis}; matching fiscal start, tag and unit; no amended or conflicting operand values',
                    f'{f.tag}|{f.accession}|{f.start}|{f.end}|{f.value}|{f.source}',
                    f'minus {p.tag}|{p.accession}|{p.start}|{p.end}|{p.value}|{p.source}']}))
    return result


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
    for f in cash_quarters(available):
        key=(f.metric,f.end,f.unit)
        old=selected.get(key)
        if old is None or f.filed>old.filed:
            selected[key]=f
    return sorted(selected.values(), key=lambda f: (f.end, f.metric))
