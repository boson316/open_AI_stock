"""TSMC official SEC 6-K quarterly earnings tables; explicit TWD scale.

No vendor data, forecast extraction, currency conversion or ADR EPS inference.
Quarter columns and million-TWD units must match the reviewed release layout.
"""
import calendar
from datetime import date
import re
from .inline import InlineParser
from .models import Fact


def parse_release(content, *, source, accession, filed):
    if not source.startswith('https://www.sec.gov/Archives/edgar/data/1046179/'):
        raise ValueError('Only official TSM SEC release accepted')
    parser=InlineParser();parser.feed(content)
    if not re.search(r'NT\$\s*million,\s*except\s*for\s*EPS',parser.root.text(),re.I):
        raise ValueError('TSM release currency/scale not recognized')
    metrics={'Net sales':'revenue','Gross profit':'gross_profit','Income from operations':'operating_income','Net income':'net_income','EPS (NT$)':'eps'}
    facts=[]
    active_header=None
    for table in parser.root.walk('table'):
        rows=[[' '.join(c.text().split()) for c in row.children if c.tag in {'td','th'}] for row in table.walk('tr')]
        header=next((row for row in rows if sum(bool(re.fullmatch(r'[1-4]Q\d{2}(?:\s*Amount[a-z]?)?',c)) for c in row)==3),None)
        if header:
            active_header=header
        elif active_header and any(row and row[0] in metrics for row in rows):
            # SEC HTML can split a printed financial table across pages without
            # repeating its header. Only recognized continuation rows qualify.
            header=active_header
        else:
            continue
        columns=[]
        for index,label in enumerate(header):
            match=re.fullmatch(r'([1-4])Q(\d{2})(?:\s*Amount[a-z]?)?',label)
            if match:
                quarter,year=int(match[1]),2000+int(match[2]);month=quarter*3
                columns.append((index,date(year,month-2,1),date(year,month,calendar.monthrange(year,month)[1])))
        for row in rows:
            if not row or row[0] not in metrics:continue
            metric=metrics[row[0]]
            for index,start,end in columns:
                if index>=len(row):raise ValueError('TSM release column mismatch')
                text=row[index]
                # EPS footnote superscripts become letters in text extraction.
                pattern=r'([\d,]+(?:\.\d+)?)[a-z]?' if metric=='eps' else r'([\d,]+(?:\.\d+)?)'
                value=re.fullmatch(pattern,text)
                if not value:raise ValueError('TSM release value format changed')
                facts.append(Fact(metric=metric,value=float(value[1].replace(',',''))*(1 if metric=='eps' else 1000000),
                    unit='TWD/shares' if metric=='eps' else 'TWD',start=start,end=end,filed=filed,accession=accession,
                    tag=f'disclosure:tsm.{metric}',source=source,form='6-K',
                    lineage=['Official consolidated TIFRS earnings release; TWD million except ordinary-share diluted EPS; non-XBRL row']))
    if len(facts)<15:raise ValueError('TSM consolidated quarterly table not recognized')
    return facts


def fetch_releases(client,limit=20):
    from .history import filings
    r=filings(client,'0001046179')
    selected=[i for i,f in enumerate(r['form']) if f=='6-K' and r['filingDate'][i]>='2021-01-01'
              and int(r['filingDate'][i][5:7]) in {1,4,7,10} and 10<=int(r['filingDate'][i][8:10])<=22
              and (re.fullmatch(r'tsm-\d{8}x6k.htm',r['primaryDocument'][i]) or re.fullmatch(r'tsm-6k_\d{8}.htm',r['primaryDocument'][i]))]
    if not selected:raise ValueError('No recognized TSM quarterly filings')
    result=[]
    count=0
    for i in selected:
        acc=r['accessionNumber'][i];base=f"https://www.sec.gov/Archives/edgar/data/1046179/{acc.replace('-','')}/"
        directory=client.get_json(base+'index.json')['directory']['item']
        names=[x['name'] for x in directory if re.fullmatch(r'a[1-4]q\d{2}e.*\.htm',x['name'],re.I) or re.fullmatch(r'tsm-ex991_\d+\.htm',x['name'])]
        if len(names)!=1:continue
        url=base+names[0]
        try:
            result.extend(parse_release(client.get_bytes(url).decode(),source=url,accession=acc,filed=r['filingDate'][i]))
            count+=1
        except ValueError as exc:
            raise ValueError(f'{url}: {exc}') from exc
        if count>=limit:break
    return result
