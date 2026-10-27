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
        'core_complete':not errors,'errors':errors,'annual_checks':checks,'periods':records,
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
        print(f"{d.ticker}: {item['quarters']} quarters, core {'PASS' if item['core_complete'] else 'FAIL'}, {item['first_end']} → {item['last_end']}")
        for error in item['errors']:print('  '+error)
    complete=bool(results) and all(x['core_complete'] for x in results)
    if check:
        if not existing or existing['companies']!=results:
            raise ValueError('Coverage report missing/stale; regenerate with python -m openstock.coverage')
    else:
        atomic_json(directory/'coverage.json',{'version':1,'generated_at':datetime.now(timezone.utc).isoformat(),
            'core_metrics':list(CORE),'note':'Core quarterly coverage only. Optional missing fields are disclosed; historical EPS is as reported, not uniformly split adjusted.',
            'complete':complete,'companies':results})
        atomic_json(directory/'catalog.json',catalog)
    if not complete:raise ValueError('Core quarterly coverage incomplete or financial reconciliation failed')
    return results


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');p.add_argument('--directory',type=Path,default=Path('public/data'))
    args=p.parse_args();run(args.directory,args.check)
