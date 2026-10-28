"""Audit 20 contiguous reported quarters per ticker, not merely 20 data points.

Core coverage = revenue, net income and directly reported diluted EPS. Optional
statement fields remain explicitly missing. IASB IFRS annual profit is never
forced to reconcile with TIFRS quarterly profit; EPS is never summed to annual.
"""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
from .models import Dataset
from .normalize import quarters
from .mapping import METRICS,INSTANT
from .pipeline import atomic_json

CORE=('revenue','net_income','eps')


CASH=('ocf','icf','financing_cf','capex','sbc')


def audit_cash(dataset,q):
    rows=sorted((f for f in q if f.metric=='ocf'),key=lambda f:f.end)[-20:]
    errors=[];periods=[];checks=[]
    if len(rows)!=20:errors.append(f'Only {len(rows)} operating cash quarters')
    for a,b in zip(rows,rows[1:]):
        if b.start is None or (b.start-a.end).days!=1:errors.append(f'Cash quarter gap {a.end} -> {b.start}')
    for r in rows:
        values={}
        for m in CASH:
            f=next((f for f in q if f.metric==m and f.start==r.start and f.end==r.end and f.unit==dataset.currency),None)
            if not f:errors.append(f'{r.end}: missing {m}');continue
            if dataset.ticker=='TSM' and f.reporting_basis!='TIFRS':errors.append(f'{r.end}: incompatible cash basis')
            values[m]={k:v for k,v in f.model_dump(mode='json').items() if k in {'value','unit','source','source_refs','quality','filed','reporting_basis','report_fiscal_year','lineage'}}
        entry={'start':str(r.start),'end':str(r.end),'metrics':values}
        if 'ocf' in values and 'capex' in values:
            # CapEx is published as a positive outflow; FCF = OCF - CapEx. Negative CapEx would silently invert it.
            if values['capex']['value']<0:errors.append(f'{r.end}: capex is negative; sign convention violated')
            entry['fcf']=values['ocf']['value']-abs(values['capex']['value'])
        periods.append(entry)
    annuals={}
    for f in sorted(dataset.facts,key=lambda f:(f.filed,f.accession)):
        if f.metric in CASH and f.start and 350<=(f.end-f.start).days+1<=380:
            annuals[(f.metric,f.start,f.end)]=f
    for (m,start,end),f in annuals.items():
        subset=[r for r in periods if r['start']>=str(start) and r['end']<=str(end)]
        if len(subset)!=4 or subset[0]['start']!=str(start) or subset[-1]['end']!=str(end) or any(m not in r['metrics'] for r in subset):continue
        vintages={r['metrics'][m].get('report_fiscal_year') for r in subset}
        latest=f
        compatible=[a for a in dataset.facts if a.metric==m and a.start==start and a.end==end and a.report_fiscal_year in vintages]
        if len(vintages)==1 and compatible:
            f=max(compatible,key=lambda a:(a.filed,a.accession))
        difference=sum(r['metrics'][m]['value'] for r in subset)-f.value
        if latest.value!=f.value:
            checks.append({'metric':m,'end':str(end),'status':'different_vintage','source':latest.source,
                'reason':'Latest annual comparative was revised; quarterly series retains available disclosed vintage. No unsupported quarterly allocation.',
                'annual_value':latest.value,'quarter_vintage_annual_value':f.value})
        passed=abs(difference)<=1
        checks.append({'metric':m,'end':str(end),'difference':difference,'status':'passed' if passed else 'failed','source':f.source})
        if not passed:errors.append(f'{end}: cash {m} annual reconciliation differs by {difference}')
    return {'quarters':len(rows),'first_end':str(rows[0].end) if rows else None,'last_end':str(rows[-1].end) if rows else None,
        'complete':not errors,'errors':errors,'periods':periods,'annual_checks':checks}


GROSS_MARGIN_NOT_APPLICABLE={'SOFI':'Net revenue is interest plus non-interest income of a financial company; no cost of goods sold. Operating income is never substituted.'}


def reviewed_gross_profit_tag(tag):
    # XBRL GrossProfit, reviewed revenue-minus-cost, or a direct line in an official issuer release (8-K/6-K exhibit).
    return tag in {'us-gaap:GrossProfit','ifrs-full:GrossProfit','calculated:revenue-minus-cost'} or (tag.startswith('disclosure:') and tag.endswith('.gross_profit'))


def audit_gross_margin(dataset,q):
    """Gross margin needs gross profit and revenue for the same period, unit and exact quarter.

    Reported gross profit, or a reviewed same-accession revenue minus cost of
    revenue, is accepted. Operating income is never a substitute. Financial
    issuers are explicitly not applicable and must hold no gross profit facts.
    """
    if dataset.ticker in GROSS_MARGIN_NOT_APPLICABLE:
        stray=[f for f in dataset.facts if f.metric=='gross_profit']
        errors=['Not-applicable issuer publishes gross profit facts'] if stray else []
        return {'status':'not_applicable','reason':GROSS_MARGIN_NOT_APPLICABLE[dataset.ticker],'quarters':0,'complete':not errors,'errors':errors,'periods':[]}
    revenue=sorted((f for f in q if f.metric=='revenue'),key=lambda f:f.end)[-20:]
    operating={(f.start,f.end):f.value for f in q if f.metric=='operating_income'}
    errors=[];periods=[]
    for r in revenue:
        g=next((f for f in q if f.metric=='gross_profit' and f.start==r.start and f.end==r.end),None)
        if g is None:errors.append(f'{r.end}: missing gross profit');continue
        if g.unit!=r.unit or g.unit!=dataset.currency:errors.append(f'{r.end}: gross profit unit differs from revenue')
        if not reviewed_gross_profit_tag(g.tag):errors.append(f'{r.end}: unreviewed gross profit tag {g.tag}')
        if g.value>r.value:errors.append(f'{r.end}: gross profit exceeds revenue')
        if (r.start,r.end) in operating and operating[(r.start,r.end)]==g.value and g.value!=0:
            errors.append(f'{r.end}: gross profit equals operating income; possible substitution')
        if g.tag=='calculated:revenue-minus-cost' and len(g.source_refs or [g.source])<1:errors.append(f'{r.end}: calculated gross profit lacks sources')
        periods.append({'start':str(r.start),'end':str(r.end),'gross_profit':g.value,'revenue':r.value,'margin_pct':g.value/r.value*100,
            'unit':g.unit,'tag':g.tag,'quality':g.quality,'filed':str(g.filed),'source':g.source,'source_refs':g.source_refs,'lineage':g.lineage})
    # Same-accession reported gross profit must agree with revenue - cost when both are filed.
    for rep in (f for f in dataset.facts if f.metric=='gross_profit' and f.tag!='calculated:revenue-minus-cost'):
        calc=[f for f in dataset.facts if f.metric=='gross_profit' and f.tag=='calculated:revenue-minus-cost' and (f.start,f.end,f.accession)==(rep.start,rep.end,rep.accession)]
        errors+=[f'{rep.end}: reported and calculated gross profit disagree' for c in calc if c.value!=rep.value]
    return {'status':'checked','quarters':len(periods),'complete':not errors and len(periods)==20,
        'errors':errors+([f'Only {len(periods)} gross margin quarters'] if len(periods)!=20 and not errors else []),'periods':periods}


def audit_dataset(dataset):
    q=quarters(dataset.facts)
    revenue=sorted((f for f in q if f.metric=='revenue'),key=lambda f:f.end)[-20:]
    errors=[]
    if len(revenue)!=20:errors.append(f'Only {len(revenue)} quarters')
    for a,b in zip(revenue,revenue[1:]):
        if b.start is None or (b.start-a.end).days!=1:errors.append(f'Quarter gap/overlap {a.end} -> {b.start}')
    if revenue and (revenue[0].start is None or not 1730 <= (revenue[-1].end-revenue[0].start).days+1 <= 1920):
        errors.append('20-quarter fiscal span is not approximately five years')
    records=[]
    optional=[m for m in METRICS if m not in CORE and m not in {'deposits','allowance','net_interest_income'}]
    for r in revenue:
        metrics={}
        for metric in CORE:
            fact=next((f for f in q if f.metric==metric and f.end==r.end and f.start==r.start),None)
            expected=dataset.currency+('/shares' if metric=='eps' else '')
            if not fact:errors.append(f'{r.end}: missing {metric} for exact fiscal period');continue
            if fact.unit!=expected:errors.append(f'{r.end}: incompatible {metric} unit')
            if metric=='eps' and fact.quality!='reported':errors.append(f'{r.end}: EPS is not directly reported')
            if not fact.source.startswith(f'https://www.sec.gov/Archives/edgar/data/{int(dataset.cik)}/'):
                errors.append(f'{r.end}: unexpected official source identity')
            metrics[metric]={k:v for k,v in fact.model_dump(mode='json').items() if k in {'value','unit','filed','accession','tag','source','quality','basis'}}
        records.append({'start':str(r.start),'end':str(r.end),'metrics':metrics,
            'missing_optional':[m for m in optional if not any(f.metric==m and f.end==r.end and (m in INSTANT or f.start==r.start) for f in q)]})
    annuals={}
    for f in sorted(dataset.facts,key=lambda f:(f.filed,f.accession)):
        if f.metric in {'revenue','net_income'} and f.start and 350<=(f.end-f.start).days+1<=380 and revenue and f.end>=revenue[0].end:
            annuals[(f.metric,f.start,f.end)]=f
    checks=[]
    for (metric,start,end),year in annuals.items():
        rows=[f for f in q if f.metric==metric and f.start and start<=f.start and f.end<=end]
        if len(rows)!=4 or rows[0].start!=start or rows[-1].end!=end:continue
        if dataset.ticker=='TSM' and metric=='net_income':
            checks.append({'metric':metric,'end':str(end),'status':'not_comparable','reason':'Annual IFRS (IASB) vs quarterly TIFRS; not combined','annual_source':year.source})
            continue
        difference=sum(f.value for f in rows)-year.value
        # Issuer release monetary values are rounded to millions (PLTR thousands).
        tolerance=2000 if dataset.ticker=='PLTR' else 2000000
        passed=abs(difference)<=tolerance
        checks.append({'metric':metric,'end':str(end),'status':'passed' if passed else 'failed','difference':difference,'tolerance':tolerance,'annual_source':year.source})
        if not passed:errors.append(f'{end}: {metric} does not reconcile to annual: {difference}')
    return {'ticker':dataset.ticker,'cik':dataset.cik,'currency':dataset.currency,'quarters':len(records),
        'first_end':records[0]['end'] if records else None,'last_end':records[-1]['end'] if records else None,
        'core_complete':not errors,'errors':errors,'cashflow':audit_cash(dataset,q),'gross_margin':audit_gross_margin(dataset,q),'annual_checks':checks,'periods':records,
        'missing_optional_counts':{m:sum(m in r['missing_optional'] for r in records) for m in optional}}


def run(directory,check=False):
    catalog=json.loads((directory/'catalog.json').read_text());results=[]
    existing=json.loads((directory/'coverage.json').read_text()) if check and (directory/'coverage.json').exists() else None
    for company in catalog['companies']:
        if company['status']!='available':continue
        raw=(directory/company['file']).read_bytes();d=Dataset.model_validate_json(raw)
        item=audit_dataset(d);item['dataset_sha256']=hashlib.sha256(raw).hexdigest();results.append(item)
        if not check:
            company['coverage']={k:item[k] for k in ['quarters','first_end','last_end','core_complete']}
        print(f"{d.ticker}: {item['quarters']} quarters, core {'PASS' if item['core_complete'] else 'FAIL'}, cash {'PASS' if item['cashflow']['complete'] else 'FAIL'}, gross margin {item['gross_margin']['status'] if item['gross_margin']['status']=='not_applicable' else ('PASS' if item['gross_margin']['complete'] else 'FAIL')}, {item['first_end']} → {item['last_end']}")
        for error in item['errors']+item['cashflow']['errors']+item['gross_margin']['errors']:print('  '+error)
    # Publishing is gated on every audited dimension, not only core income.
    complete=bool(results) and all(x['core_complete'] and x['cashflow']['complete'] and x['gross_margin']['complete'] for x in results)
    if check:
        if not existing or existing['companies']!=results:
            raise ValueError('Coverage report missing/stale; regenerate with python -m openstock.coverage')
    else:
        atomic_json(directory/'coverage.json',{'version':1,'generated_at':datetime.now(timezone.utc).isoformat(),
            'core_metrics':list(CORE),'cashflow_complete':all(x['cashflow']['complete'] for x in results),'gross_margin_complete':all(x['gross_margin']['complete'] for x in results),'note':'Core income and cash flow each audit their latest 20 available contiguous quarters. Cutoffs can differ; remaining optional missing fields are disclosed. EPS is as reported.',
            'complete':complete,'companies':results})
        atomic_json(directory/'catalog.json',catalog)
    if not complete:raise ValueError('Core, cash flow or gross margin coverage incomplete, or financial reconciliation failed')
    return results


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');p.add_argument('--directory',type=Path,default=Path('public/data'))
    args=p.parse_args();run(args.directory,args.check)
