"""Official Tesla SEC update decks with extractable text (no OCR)."""
import calendar
from datetime import date
import re
from .models import Fact


def parse_update(text, *, source, accession, filed, reference_facts):
    # The financial summary appears before the operational summary. Requiring
    # five explicit quarterly columns avoids parsing annual totals or outlook.
    headings=list(re.finditer(r'F\s*I\s*N\s*A\s*N\s*C\s*I\s*A\s*L\s*S\s*U\s*M\s*M\s*A\s*R\s*Y',text,re.I))
    match=next((m for m in headings if re.search(r'(?:Q[1-4][- ]20\d{2}\s*){5}',text[m.end():m.end()+1000])),None)
    if not match:return []
    body=text[match.end():]
    stop=re.search(r'O\s*P\s*E\s*R\s*A\s*T\s*I\s*O\s*N\s*A\s*L\s*S\s*U\s*M\s*M\s*A\s*R\s*Y',body,re.I)
    if stop:body=body[:stop.start()]
    header=re.search(r'((?:Q[1-4][- ]20\d{2}\s*){5})',body)
    if not header or not re.search(r'in millions',body[:header.end()],re.I):return []
    periods=re.findall(r'Q([1-4])[- ](20\d{2})',header[1])
    definitions={
        'revenue':r'Total revenues',
        'gross_profit':r'Total gross profit',
        'operating_income':r'Income from operations',
        'net_income':r'Net income attributable to common stockholders \(GAAP\)',
        'eps':r'EPS attributable to common stockholders, diluted \(GAAP\)',
        'ocf':r'(?:Net cash provided by operating activities|Operating cash flow)',
        'capex':r'Capital expenditures',
    }
    result=[]
    number=r'\(?-?[\d,]+(?:\.\d+)?\)?'
    for metric,label in definitions.items():
        m=re.search(label+r'(?:\s*\(\d\))*\s+('+number+r'(?:\s+'+number+r'){4})',body,re.I)
        if not m:continue
        values=m[1].split()
        reference=next((f for f in reference_facts if f.metric==metric),None)
        if not reference:continue
        for (quarter,year),raw in zip(periods,values):
            q,y=int(quarter),int(year);month=q*3
            value=float(raw.replace(',','').strip('()'))*(-1 if raw.startswith('(') else 1)
            result.append(Fact(metric=metric,value=value*(1 if metric=='eps' else 1000000),unit='USD/shares' if metric=='eps' else 'USD',
                start=date(y,month-2,1),end=date(y,month,calendar.monthrange(y,month)[1]),filed=filed,accession=accession,
                tag=f'disclosure:0001318605.{metric}',basis=reference.basis or reference.tag,source=source,form='8-K',
                lineage=['Direct Tesla GAAP quarterly financial summary; USD million except diluted EPS; issuer comparative recasts retained']))
    if not {'revenue','net_income','eps'} <= {f.metric for f in result}:return []
    return result
