"""Direct US GAAP Q4 disclosures from reviewed issuer earnings statements.

Never derive EPS by subtracting annual/YTD EPS. The adapter accepts only a
quarter header, GAAP rows, explicit release scale and fiscal end from the 10-K.
"""
import calendar
from datetime import date,timedelta
import re
from .inline import InlineParser
from .models import Fact
from .history import filings

MONTHS='January February March April May June July August September October November December'.split()


def cells(table):
    return [[' '.join(c.text().split()) for c in row.children if c.tag in {'td','th'}] for row in table.walk('tr')]


def numeric(cell):
    text=cell.strip().replace('$','').replace(',','').replace('\u2212','-').replace(' ','')
    if not re.fullmatch(r'\(?-?\d+(?:\.\d+)?\)?',text):return None
    # SEC tables sometimes place the closing parenthesis in a separate cell.
    return -float(text.strip('()')) if '(' in text or ')' in text else float(text)


def quarter_column(rows,end):
    head=rows[:12]
    # Exact fiscal dates take priority (52/53-week issuers).
    for row in head:
        ds=[]
        for cell in row:
            m=re.fullmatch(r'('+'|'.join(MONTHS)+r')\s*(\d{1,2}),?\s*(20\d{2})',cell)
            if m:ds.append(date(int(m[3]),MONTHS.index(m[1])+1,int(m[2])))
        if end in ds:return ds.index(end)
    # Calendar-quarter statement headers put years on a following row.
    for row in head:
        years=[int(c) for c in row if re.fullmatch(r'20\d{2}',c)]
        if len(years)>=2 and end.year in years:return years.index(end.year)
    # NVIDIA's explicitly GAAP fiscal-quarter summary.
    for row in head:
        qs=[c for c in row if re.fullmatch(r'Q[1-4]\s*FY\d{2,4}',c)]
        expected=f'Q4FY{str(end.year)[-2:]}'
        if qs and any(c.replace(' ','')==expected for c in qs):
            return next(i for i,c in enumerate(qs) if c.replace(' ','')==expected)
    return None


def parse_release(content, *, cik, end, start, filed, accession, source, reference_facts):
    if not source.startswith(f'https://www.sec.gov/Archives/edgar/data/{int(cik)}/'):
        raise ValueError('Release CIK/source mismatch')
    p=InlineParser();p.feed(content)
    doc=' '.join(p.root.text(' ').split())
    if cik=='0001318605':
        from .tesla import parse_update
        return parse_update(' '.join(p.root.text().split()),source=source,accession=accession,filed=filed,reference_facts=reference_facts)
    scale=1000 if cik in {'0001321655','0001818874'} else 1000000
    scale_word='thousands' if scale==1000 else 'millions'
    if not re.search(r'\b'+scale_word+r'\b',doc,re.I):return []
    result={}
    for table in p.root.walk('table'):
        rs=cells(table)
        text=' '.join(' '.join(r) for r in rs)
        if re.search(r'non[\s-]*gaap|as adjusted|reconciliation',text,re.I):continue
        if not re.search(r'three\s*months\s*ended|quarter\s*ended|Q4\s*FY|4th\s*Qtr',text,re.I):continue
        column=quarter_column(rs,end)
        if column is None:continue
        eps_group=False
        local={}
        for row in rs:
            nonempty=[c for c in row if c]
            if not nonempty:continue
            label=nonempty[0].lower().rstrip(':').strip()
            values=[n for c in nonempty[1:] if (n:=numeric(c)) is not None]
            if not values:
                if re.search(r'earnings(?: \(loss\))? per share|net income per share',label):eps_group=True
                if re.search(r'shares|weighted',label) and 'per share' not in label:eps_group=False
                if re.search(r'shares used|weighted.average',label):eps_group=False
                continue
            metric=None
            if label in {'revenue','revenues','total revenue','net revenue','total net revenue','total net sales','net sales','total revenues'}:metric='revenue'
            if label in {'net income','net income (loss)','net (loss) income','net loss'}:metric='net_income'
            if re.match(r'net (?:income|loss)(?: \(loss\))? attributable to (?:common stockholders|palantir technologies)',label) and not any(w in label for w in ['diluted','basic']):metric='net_income'
            if label in {'gross profit','gross margin'} and '%' not in nonempty:metric='gross_profit'
            if label in {'operating income','income from operations','operating income (loss)','income (loss) from operations'}:metric='operating_income'
            if ('diluted' in label and ('per share' in label or label=='diluted' and eps_group)
                and not any(w in label for w in ['weighted','shares used','continuing','discontinued','adjusted'])):metric='eps'
            if not metric or column>=len(values):continue
            amount=values[column]*(1 if metric=='eps' else scale)
            reference=next((f for f in reference_facts if f.metric==metric),None)
            if not reference:continue
            local[metric]=Fact(metric=metric,value=amount,unit='USD/shares' if metric=='eps' else 'USD',start=start,end=end,
                filed=filed,accession=accession,tag=f'disclosure:{cik}.{metric}',basis=reference.basis or reference.tag,
                source=source,form='8-K',lineage=[f'Direct GAAP quarterly disclosure; source scale {scale_word} except EPS; original as-reported share basis'])
        # An income statement must identify revenue, profit and diluted EPS.
        if {'revenue','net_income','eps'} <= set(local):
            if result and any(result[m].value!=local[m].value for m in set(result)&set(local)):
                raise ValueError('Conflicting quarterly GAAP tables require review')
            result.update(local)
    return list(result.values())


def fetch_q4(client,cik,reference_facts):
    r=filings(client,cik)
    annuals=sorted({f.end for f in reference_facts if f.metric=='eps' and f.start and 350<=(f.end-f.start).days+1<=380 and str(f.end)>='2021-01-01'})[-6:]
    result=[]
    if cik=='0001318605':
        from .tesla_verified import verified_history
        result.extend(verified_history(client,reference_facts))
    for end in annuals:
        fy=[f for f in reference_facts if f.metric=='eps' and f.end==end and f.start and 350<=(f.end-f.start).days+1<=380]
        first_filed=min(f.filed for f in fy)
        q3=[f for f in reference_facts if f.metric=='eps' and f.start and 70<=(f.end-f.start).days+1<=105 and 70<=(end-f.end).days<=105]
        if not q3:continue
        start=max(f.end for f in q3)+timedelta(days=1)
        candidates=[i for i,form in enumerate(r['form']) if form=='8-K' and '2.02' in r['items'][i] and 0<(date.fromisoformat(r['filingDate'][i])-end).days<80]
        candidates.sort(key=lambda i:abs((date.fromisoformat(r['filingDate'][i])-first_filed).days))
        found=[]
        for i in candidates[:3]:
            acc=r['accessionNumber'][i];base=f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-','')}/"
            names=[x['name'] for x in client.get_json(base+'index.json')['directory']['item'] if x['name'].endswith('.htm') and x['name']!=r['primaryDocument'][i] and not x['name'].startswith('R') and not x['name'].endswith('-index.htm')]
            for name in names[:4]:
                if 'slides' in name.lower() or 'ex992' in name.lower():continue
                url=base+name
                facts=parse_release(client.get_bytes(url).decode(),cik=cik,end=end,start=start,filed=r['filingDate'][i],accession=acc,source=url,reference_facts=reference_facts)
                if facts:found=facts;break
            if found:break
        if not found and not {'revenue','net_income','eps'} <= {f.metric for f in result if f.end==end}:
            print(f'Quarterly GAAP exhibit needs review: {cik} {end}',flush=True)
        result.extend(found)
    return result
