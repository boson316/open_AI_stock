"""Gross profit = revenue minus cost of revenue for reviewed nonfinancial issuers.

Match exact periods, units and accession; retain reported gross profit priority.
Cash-like stable-vintage subtraction can then resolve additive Q4 gross profit.
"""
from .models import Fact

REVIEWED={'0001652044','0001045810','0001018724','0001326801'}


def add_gross_profit(facts,cik):
    if cik not in REVIEWED:return facts
    basis=cik+':consolidated-gross-profit'
    result=[f.model_copy(update={'basis':basis}) if f.metric=='gross_profit' else f for f in facts]
    costs={}
    for f in facts:
        if f.metric=='cost_revenue':costs.setdefault((f.start,f.end,f.unit,f.accession),[]).append(f)
    seen=set()
    for r in facts:
        if r.metric!='revenue' or r.start is None:continue
        key=(r.start,r.end,r.unit,r.accession)
        cs=costs.get(key,[])
        if len({c.value for c in cs})!=1 or key in seen:continue
        c=cs[0];seen.add(key)
        result.append(Fact(metric='gross_profit',value=r.value-c.value,unit=r.unit,start=r.start,end=r.end,
            filed=max(r.filed,c.filed),accession=r.accession,tag='calculated:revenue-minus-cost',basis=basis,
            report_fiscal_year=r.report_fiscal_year,reporting_basis='US GAAP',source=r.source,source_refs=list(dict.fromkeys([r.source,c.source])),form=r.form,quality='derived',
            lineage=[f'Revenue {r.tag}: {r.value}; exact period and accession',f'minus cost of revenue {c.tag}: {c.value}', 'Gross profit calculated from consolidated reported amounts; not operating income']))
    return result
